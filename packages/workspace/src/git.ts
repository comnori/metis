import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BoundaryError, type GitStatus, type GitFile, type GitVersion, type GitVersionRequest, type PathRequest, type ScopedRequest } from '@metis/contracts';
import type { Workspace } from './index';

const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const limit = 2 * 1024 * 1024;
function decode(bytes: Buffer) {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new BoundaryError('UNSUPPORTED_FILE', 'Git 내용은 UTF-8 문서만 표시할 수 있습니다.'); }
  if (text.includes('\0')) throw new BoundaryError('UNSUPPORTED_FILE', 'Git 바이너리 내용은 표시하지 않습니다.');
  return text;
}
function run(root: string, args: string[], config: string[] = []): Promise<Buffer> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', ...config, ...args], {
      cwd: root, env: { ...env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' }, windowsHide: true, timeout: 10000, maxBuffer: limit, encoding: 'buffer'
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr })); else resolve(stdout);
    });
  });
}
function gitError(error: unknown): never {
  if (error instanceof BoundaryError) throw error;
  const e = error as { code?: string; killed?: boolean };
  throw new BoundaryError(e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'TOO_LARGE' : 'INTERNAL_ERROR', e.code === 'ENOENT' ? 'Git 실행 파일을 찾지 못했습니다. 문서 편집은 계속 사용할 수 있습니다.' : e.killed ? 'Git 조회 시간 한도(10초)를 초과했습니다.' : 'Git 조회를 완료하지 못했습니다. 저장소 접근 권한·상태와 Git 설치를 확인하세요.');
}
export class GitWorkspace {
  constructor(private workspace: Workspace) {}
  private async root(request: ScopedRequest) {
    const root = this.workspace.analysisRoot(request);
    try {
      const top = decode(await run(root, ['rev-parse', '--show-toplevel'])).trimEnd();
      if (await fs.realpath(top) !== root) throw new BoundaryError('OUTSIDE_WORKSPACE', 'Git 조회는 저장소 루트 폴더를 작업 공간으로 열어 사용하세요.');
      this.workspace.analysisRoot(request); return root;
    } catch (error) {
      if (!(error instanceof BoundaryError) && (error as { stderr?: Buffer }).stderr?.toString().includes('not a git repository')) throw new BoundaryError('NOT_FOUND', 'Git 저장소가 아닌 폴더입니다. 문서 편집은 계속 사용할 수 있습니다.');
      return gitError(error);
    }
  }
  private async head(root: string): Promise<string | undefined> {
    try { const value = decode(await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim(); if (!oid.test(value)) throw new Error('Invalid HEAD'); return value; }
    catch (error) { if ((error as { code?: number }).code === 1) return undefined; throw error; }
  }
  private async blob(root: string, id: string) { if (!oid.test(id)) throw new BoundaryError('INVALID_REQUEST', 'Git 객체를 확인할 수 없습니다.'); return decode(await run(root, ['cat-file', 'blob', id])); }
  private async versionText(root: string, file: string, commit: string): Promise<string | undefined> {
    const row = (await run(root, ['ls-tree', '-z', commit, '--', file])).toString('utf8').split('\0').filter(Boolean);
    if (!row.length) return undefined;
    const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(row[0]);
    if (row.length !== 1 || !match || row[0].slice(match[0].length) !== file) throw new BoundaryError('UNSUPPORTED_FILE', 'Git의 일반 문서만 비교할 수 있습니다. 링크·서브모듈은 제외합니다.');
    return this.blob(root, match[2]);
  }
  async status(request: ScopedRequest): Promise<GitStatus> {
    try {
      const root = await this.root(request), config: string[] = [];
      // Status can run clean/process filters. Disable configured drivers as well as fsmonitor.
      let names = '';
      try { names = (await run(root, ['config', '--name-only', '--get-regexp', '^filter\\.'])).toString('utf8'); } catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
      for (const name of new Set(names.split('\n').map(key => /^filter\.(.+)\.[^.]+$/.exec(key)?.[1]).filter((name): name is string => !!name))) {
        for (const suffix of ['clean=', 'smudge=', 'process=', 'required=false']) config.push('-c', `filter.${name}.${suffix}`);
      }
      const rows = (await run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=all'], config)).toString('utf8').split('\0').filter(Boolean);
      const all = rows.filter(row => /\.adoc$/i.test(row.slice(3))).map(row => ({ relativePath: row.slice(3), index: row[0], worktree: row[1] }));
      this.workspace.analysisRoot(request);
      return { changes: all.slice(0, 500), partial: all.length > 500 };
    } catch (error) { return gitError(error); }
  }
  async file(request: PathRequest): Promise<GitFile> {
    try {
      const root = await this.root(request), commit = await this.head(root), warnings: string[] = [];
      let disk: GitFile['disk'];
      try { disk = await this.workspace.read(request); if (disk.byteLength > limit) throw new BoundaryError('TOO_LARGE', 'Git 비교는 문서별 2 MiB까지 지원합니다.'); }
      catch (error) { if ((error as { code?: string }).code !== 'ENOENT' && (error as { code?: string }).code !== 'ENOTDIR') throw error; warnings.push('디스크에 파일이 없습니다. 기존 파일 복원 초안 적용은 사용할 수 없습니다.'); }
      const entries = (await run(root, ['ls-files', '--stage', '-z', '--', request.relativePath])).toString('utf8').split('\0').filter(Boolean);
      let staged: string | undefined;
      if (entries.length) {
        const match = /^(100644|100755) ([a-f0-9]+) 0\t/.exec(entries[0]);
        if (entries.length !== 1 || !match || entries[0].slice(match[0].length) !== request.relativePath) warnings.push('병합 충돌 또는 일반 파일이 아닌 인덱스입니다. 스테이지 내용은 표시하지 않습니다.');
        else staged = await this.blob(root, match[2]);
      }
      const head = commit ? await this.versionText(root, request.relativePath, commit) : undefined;
      const history: GitFile['history'] = [];
      if (commit) {
        const rows = (await run(root, ['log', '-n', '51', '--format=%H%x00%aI%x00%s%x00', commit, '--', request.relativePath])).toString('utf8').split('\0');
        for (let i = 0; i + 2 < rows.length; i += 3) { const id = rows[i].trim(); if (oid.test(id)) history.push({ id, date: rows[i + 1], subject: rows[i + 2] }); }
      }
      if (history.length > 50) warnings.push('최근 50개 이력만 표시합니다.');
      if (await this.head(root) !== commit) throw new BoundaryError('CONFLICT', '조회 중 HEAD가 변경되었습니다. 다시 조회하세요.');
      this.workspace.analysisRoot(request);
      return { relativePath: request.relativePath, disk, staged, head, history: history.slice(0, 50), warnings };
    } catch (error) { return gitError(error); }
  }
  async version(request: GitVersionRequest): Promise<GitVersion> {
    try {
      const root = await this.root(request);
      const text = await this.versionText(root, request.relativePath, request.commit);
      if (text === undefined) throw new BoundaryError('NOT_FOUND', '선택한 이력에 이 경로의 문서가 없습니다. 삭제 이전 이력을 선택하세요.');
      this.workspace.analysisRoot(request); return { relativePath: request.relativePath, commit: request.commit, text };
    } catch (error) { return gitError(error); }
  }
}

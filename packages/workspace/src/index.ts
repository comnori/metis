import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { guardedSave } from './save';
import { Recovery } from './recovery';
import type { CopyRequest, AnalyzeRequest } from '@metis/contracts';
export { Recovery } from './recovery';
export { FileChanges } from './file-change';
export { GitWorkspace } from './git';
export { ExternalEditor } from './external';
export { LaunchQueue, parseLaunch } from './launch';
import type { SaveRequest } from '@metis/contracts';
import { BoundaryError, validFolderName, type CreateDirectoryRequest, type Session, type ScopedRequest, type PathRequest, type Entry, type DocumentSnapshot } from '@metis/contracts';
export { Recents } from './recents';
const limit = 16 * 1024 * 1024;
export class Workspace {
  constructor(private recoveryRoot?: string) {}
  private current?: Session & { root: string };
  private epoch = 0;
  analysisRoot(request: ScopedRequest): string { return this.session(request).root; }
  async externalPath(request: PathRequest) { await this.read(request); return this.resolve(request); }
  async open(root: string): Promise<Session> {
    const resolved = await fs.realpath(root);
    if (!(await fs.stat(resolved)).isDirectory()) throw new BoundaryError('UNSUPPORTED_FILE', '폴더를 선택해 주세요.');
    await fs.readdir(resolved);
    let readOnly = false;
    try { await fs.access(resolved, constants.W_OK); } catch { readOnly = true; }
    this.current = { viewKey: createHash('sha256').update(resolved).digest('hex'), root: resolved, name: path.basename(resolved) || resolved, readOnly, workspaceId: randomUUID(), workspaceEpoch: ++this.epoch };
    const { root: _, ...session } = this.current;
    return session;
  }
  private session(request: ScopedRequest) {
    if (!this.current) throw new BoundaryError('NO_WORKSPACE', '먼저 폴더를 열어 주세요.');
    if (request.workspaceId !== this.current.workspaceId || request.workspaceEpoch !== this.current.workspaceEpoch)
      throw new BoundaryError('STALE_WORKSPACE', '작업 공간이 변경되었습니다.');
    return this.current;
  }
  close(request: ScopedRequest) { this.session(request); this.current = undefined; this.epoch++; return null; }
  async createDirectory(request: CreateDirectoryRequest): Promise<Entry> {
    if (!validFolderName(request.name)) throw new BoundaryError('INVALID_REQUEST', '폴더 이름을 확인해 주세요.');
    const parent = await this.resolve(request);
    this.session(request);
    await fs.mkdir(path.join(parent, request.name));
    this.session(request);
    return { name: request.name, relativePath: [request.relativePath, request.name].filter(Boolean).join('/'), kind: 'directory' };
  }
  async createDocument(request: CreateDirectoryRequest): Promise<DocumentSnapshot> {
    if (!validFolderName(request.name) || !/\.adoc$/i.test(request.name)) throw new BoundaryError('INVALID_REQUEST', 'AsciiDoc 파일 이름을 입력해 주세요.');
    const parent = await this.resolve(request);
    this.session(request);
    await fs.writeFile(path.join(parent, request.name), '', { flag: 'wx', flush: true });
    return this.read({ ...request, relativePath: [request.relativePath, request.name].filter(Boolean).join('/') });
  }
  async save(request: SaveRequest): Promise<DocumentSnapshot> {
    if (!this.recoveryRoot) throw new BoundaryError('INTERNAL_ERROR', '복구 위치가 준비되지 않았습니다.');
    const original = await this.read(request);
    if (original.revision !== request.revision) throw new BoundaryError('CONFLICT', '외부에서 문서가 변경되었습니다. 편집 내용을 유지했습니다.');
    if (original.readOnly || original.eol === 'mixed') throw new BoundaryError('ACCESS_DENIED', '읽기 전용 또는 혼합 줄바꿈 문서는 저장할 수 없습니다.');
    const separator = original.eol === 'crlf' ? '\r\n' : original.eol === 'cr' ? '\r' : '\n';
    const bytes = Buffer.from((original.bom ? '\uFEFF' : '') + request.text.replaceAll('\n', separator));
    if (bytes.length > limit) throw new BoundaryError('TOO_LARGE', '저장 한도는 16 MiB입니다.');
    const target = await this.resolve(request);
    await guardedSave(target, request.revision, bytes, this.recoveryRoot, async () => {
      if (await this.resolve(request) !== target) throw new BoundaryError('CONFLICT', '저장 경로가 변경되었습니다.');
    });
    const saved = await this.read(request);
    if (saved.revision !== createHash('sha256').update(bytes).digest('hex')) throw new BoundaryError('CONFLICT', '저장 후 외부 변경을 감지했습니다. 편집 내용을 유지했습니다.');
    return saved;
  }
  async copy(request: CopyRequest): Promise<DocumentSnapshot> {
    if (!validFolderName(request.name) || !/\.adoc$/i.test(request.name)) throw new BoundaryError('INVALID_REQUEST', 'AsciiDoc 파일 이름을 확인해 주세요.');
    const bytes = Buffer.from(request.text); if (bytes.length > limit) throw new BoundaryError('TOO_LARGE', '사본 한도는 16 MiB입니다.');
    const parent = await this.resolve(request); this.session(request);
    await fs.writeFile(path.join(parent, request.name), bytes, { flag: 'wx', flush: true });
    const saved = await this.read({ ...request, relativePath: [request.relativePath, request.name].filter(Boolean).join('/') });
    if (saved.revision !== createHash('sha256').update(bytes).digest('hex')) throw new BoundaryError('CONFLICT', '사본 생성 직후 외부 변경을 감지했습니다. 원래 편집·복구 사본은 유지됩니다.');
    return saved;
  }
  async checkpoint(request: AnalyzeRequest): Promise<string> {
    if (!this.recoveryRoot || !/\.adoc$/i.test(request.relativePath)) throw new BoundaryError('INVALID_REQUEST', '보존 위치를 확인해 주세요.');
    const root = this.session(request).root, target = path.resolve(root, request.relativePath);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new BoundaryError('OUTSIDE_WORKSPACE', '작업 공간 밖의 보존 요청입니다.');
    return new Recovery(this.recoveryRoot).checkpoint(target, request.text);
  }
  async relocate(request: PathRequest, revision: string, destination: string) {
    const snapshot = await this.read(request);
    if (snapshot.revision !== revision) throw new BoundaryError('CONFLICT', '검토 이후 원본이 변경되었습니다. 다시 검토해 주세요.');
    if (snapshot.readOnly) throw new BoundaryError('ACCESS_DENIED', '읽기 전용 원본은 변경할 수 없습니다.');
    if (destination) {
      const folder = path.posix.dirname(destination);
      const parent = await this.resolve({ ...request, relativePath: folder === '.' ? '' : folder });
      try { await fs.lstat(path.join(parent, path.posix.basename(destination))); throw new BoundaryError('ALREADY_EXISTS', '이동 대상 이름이 이미 있습니다.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const source = await this.resolve(request);
    const retained = path.join(path.dirname(source), `.metis-${randomUUID()}.original`);
    if (!this.recoveryRoot) throw new BoundaryError('INTERNAL_ERROR', '복구 위치가 준비되지 않았습니다.');
    await new Recovery(this.recoveryRoot).checkpoint(source, (snapshot.bom ? '\uFEFF' : '') + snapshot.text, retained);
    if ((await this.read(request)).revision !== revision) throw new BoundaryError('CONFLICT', '작업 직전 원본이 변경되었습니다.');
    await fs.rename(source, retained);
    try {
      const stat = await fs.lstat(retained);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) throw new BoundaryError('CONFLICT', '교체 당시 원본을 확인하지 못했습니다.');
      const handle = await fs.open(retained, 'r');
      try {
        const bytes = Buffer.alloc(snapshot.byteLength + 1); let count = 0;
        while (count < bytes.length) { const chunk = await handle.read(bytes, count, bytes.length - count, count); if (!chunk.bytesRead) break; count += chunk.bytesRead; }
        if (createHash('sha256').update(bytes.subarray(0, count)).digest('hex') !== revision) throw new BoundaryError('CONFLICT', '교체 직전 외부 변경을 발견했습니다.');
      } finally { await handle.close(); }
      if (destination) await this.copy({ ...request, relativePath: path.posix.dirname(destination) === '.' ? '' : path.posix.dirname(destination), name: path.posix.basename(destination), text: (snapshot.bom ? '\uFEFF' : '') + snapshot.text });
    } catch (error) {
      try { await fs.link(retained, source); } catch { throw new BoundaryError('CONFLICT', '부분 실패: 원래 위치에 다른 파일이 있거나 복원할 수 없습니다. 복구 사본과 .metis 보존 파일을 확인해 주세요.'); }
      throw error;
    }
    // Keep the displaced inode for writers that already had the original open.
    return retained;
  }
  private async resolve(request: PathRequest) {
    const session = this.session(request);
    let candidate = session.root;
    for (const part of request.relativePath.split('/').filter(Boolean)) {
      candidate = path.join(candidate, part);
      if ((await fs.lstat(candidate)).isSymbolicLink()) throw new BoundaryError('OUTSIDE_WORKSPACE', '심볼릭 링크는 아직 지원하지 않습니다.');
    }
    const real = await fs.realpath(candidate);
    const relative = path.relative(session.root, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new BoundaryError('OUTSIDE_WORKSPACE', '작업 공간 밖의 파일에는 접근할 수 없습니다.');
    this.session(request);
    return real;
  }
  async list(request: PathRequest): Promise<Entry[]> {
    const entries = await fs.readdir(await this.resolve(request), { withFileTypes: true });
    this.session(request);
    return entries.filter(e => !e.isSymbolicLink() && (e.isDirectory() || (e.isFile() && /\.adoc$/i.test(e.name))))
      .map(e => ({ name: e.name, relativePath: [request.relativePath, e.name].filter(Boolean).join('/'), kind: e.isDirectory() ? 'directory' as const : 'document' as const }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }
  async read(request: PathRequest): Promise<DocumentSnapshot> {
    if (!/\.adoc$/i.test(request.relativePath)) throw new BoundaryError('UNSUPPORTED_FILE', 'AsciiDoc 문서만 열 수 있습니다.');
    const target = await this.resolve(request);
    const file = await fs.open(target, 'r');
    try {
      const before = await file.stat();
      if (!before.isFile()) throw new BoundaryError('UNSUPPORTED_FILE', '일반 파일만 열 수 있습니다.');
      if (before.size > limit) throw new BoundaryError('TOO_LARGE', '현재 원문 열기는 16 MiB까지 지원합니다.');
      const buffer = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await file.read(buffer, count, buffer.length - count, count);
        if (!bytesRead) break;
        count += bytesRead;
      }
      const after = await file.stat();
      if (count !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size)
        throw new BoundaryError('CHANGED_DURING_READ', '읽는 동안 파일이 변경되었습니다. 다시 열어 주세요.');
      this.session(request);
      const bytes = buffer.subarray(0, count);
      const bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new BoundaryError('UNSUPPORTED_FILE', 'UTF-8 문서만 열 수 있습니다.'); }
      if (text.includes('\0')) throw new BoundaryError('UNSUPPORTED_FILE', '바이너리 파일은 열 수 없습니다.');
      const crlf = text.includes('\r\n'), lf = /(?<!\r)\n/.test(text), cr = /\r(?!\n)/.test(text);
      let readOnly = false;
      try { await fs.access(target, constants.W_OK); } catch { readOnly = true; }
      return { relativePath: request.relativePath, text, bom, readOnly, byteLength: count, revision: createHash('sha256').update(bytes).digest('hex'),
        eol: Number(crlf) + Number(lf) + Number(cr) > 1 ? 'mixed' : crlf ? 'crlf' : lf ? 'lf' : cr ? 'cr' : 'none' };
    } finally { await file.close(); }
  }
}
export function fileError(error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new BoundaryError('NOT_FOUND', '파일 또는 폴더를 찾을 수 없습니다.');
  if (code === 'EACCES' || code === 'EPERM') return new BoundaryError('ACCESS_DENIED', '이 위치에서 요청한 작업을 수행할 권한이 없습니다. 다른 폴더를 선택해 주세요.');
  if (code === 'EROFS') return new BoundaryError('ACCESS_DENIED', '읽기 전용 위치에는 폴더를 만들 수 없습니다.');
  if (code === 'EEXIST') return new BoundaryError('ALREADY_EXISTS', '같은 이름의 파일 또는 폴더가 이미 있습니다.');
  return error;
}

export async function createWorkspaceFolder(parent: string, name: string): Promise<string> {
  if (!validFolderName(name)) throw new BoundaryError('INVALID_REQUEST', '폴더 이름을 확인해 주세요.');
  const root = await fs.realpath(parent);
  const target = path.join(root, name);
  await fs.mkdir(target);
  return target;
}

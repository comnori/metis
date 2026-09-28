import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Workspace } from './index';
import { GitWorkspace, initializeGitRepository, isOwnGitRepository } from './git';
import { validate, textDiff } from '@metis/contracts';
const roots: string[] = [];
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
function command(root: string, ...args: string[]) { return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true }); }
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-git-')); roots.push(root);
  command(root, 'init', '-b', 'main'); command(root, 'config', 'user.name', 'Metis Test'); command(root, 'config', 'user.email', 'metis@example.invalid'); command(root, 'config', 'commit.gpgsign', 'false'); command(root, 'config', 'core.autocrlf', 'false');
  const workspace = new Workspace(), session = await workspace.open(root), scope = { requestId: 'test', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch };
  return { root, workspace, git: new GitWorkspace(workspace), scope, file: { ...scope, relativePath: '한 글 [1].adoc' } };
}
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('metis-git-')) throw Error('Unsafe cleanup'); await fs.rm(root, { recursive: true, force: true }); } });
describe('Git document investigation', () => {
  it('detects only a repository rooted at the selected folder and initializes an empty folder', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-git-')); roots.push(parent); command(parent, 'init');
    const child = path.join(parent, 'child'); await fs.mkdir(child);
    expect(await isOwnGitRepository(child)).toBe(false);
    await initializeGitRepository(child);
    expect(await isOwnGitRepository(child)).toBe(true);
    expect((await fs.readdir(child)).filter(name => name !== '.git')).toEqual([]);
  });
  it('distinguishes HEAD, staged, disk and retrieves immutable history using literal paths', async () => {
    const f = await fixture(), target = path.join(f.root, f.file.relativePath);
    await fs.writeFile(target, '= Old\n'); command(f.root, 'add', '--', f.file.relativePath); command(f.root, 'commit', '-m', 'original');
    await fs.writeFile(target, '= Staged\n'); command(f.root, 'add', '--', f.file.relativePath); await fs.writeFile(target, '= Disk\n');
    expect((await f.git.status(f.scope)).changes).toEqual([{ relativePath: f.file.relativePath, index: 'M', worktree: 'M' }]);
    const result = await f.git.file(f.file);
    expect([result.head, result.staged, result.disk?.text]).toEqual(['= Old\n', '= Staged\n', '= Disk\n']);
    expect(result.history).toHaveLength(1); expect(result.history[0].subject).toBe('original');
    expect((await f.git.version({ ...f.file, commit: result.history[0].id })).text).toBe('= Old\n');
    expect(await fs.readFile(target, 'utf8')).toBe('= Disk\n');
  });
  it('handles unborn repositories, untracked files and absent history', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, f.file.relativePath), '= New');
    expect((await f.git.status(f.scope)).changes[0].index).toBe('?');
    const result = await f.git.file(f.file); expect(result.history).toEqual([]); expect(result.staged).toBeUndefined(); expect(result.head).toBeUndefined();
  });
  it('shows deleted documents and historical content without recreating files', async () => {
    const f = await fixture(), target = path.join(f.root, f.file.relativePath);
    await fs.writeFile(target, '= Old'); command(f.root, 'add', '.'); command(f.root, 'commit', '-m', 'old'); await fs.unlink(target);
    const result = await f.git.file(f.file); expect(result.disk).toBeUndefined(); expect(result.head).toBe('= Old'); expect(result.warnings.length).toBeGreaterThan(0);
    expect((await f.git.status(f.scope)).changes[0].worktree).toBe('D'); await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not execute configured clean or process filters while reading status', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, f.file.relativePath), '= Old'); command(f.root, 'add', '.'); command(f.root, 'commit', '-m', 'old');
    await fs.writeFile(path.join(f.root, '.gitattributes'), '*.adoc filter=trap\n');
    command(f.root, 'config', 'filter.trap.clean', 'echo unsafe > filter-ran'); command(f.root, 'config', 'filter.trap.process', 'echo unsafe > process-ran'); command(f.root, 'config', 'filter.trap.required', 'true');
    await fs.writeFile(path.join(f.root, f.file.relativePath), '= Changed text'); await f.git.status(f.scope);
    await expect(fs.stat(path.join(f.root, 'filter-ran'))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(fs.stat(path.join(f.root, 'process-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects non-repositories, workspace subdirectories and stale sessions', async () => {
    const f = await fixture(), nested = path.join(f.root, 'nested'); await fs.mkdir(nested);
    const child = await f.workspace.open(nested), scoped = { requestId: 'child', workspaceId: child.workspaceId, workspaceEpoch: child.workspaceEpoch };
    await expect(f.git.status(scoped)).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' }); await expect(f.git.status(f.scope)).rejects.toMatchObject({ code: 'STALE_WORKSPACE' });
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-git-')); roots.push(plain); const opened = await f.workspace.open(plain);
    await expect(f.git.status({ requestId: 'plain', ...opened })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects binary historical blobs and content over the comparison limit', async () => {
    const f = await fixture(), target = path.join(f.root, f.file.relativePath);
    await fs.writeFile(target, Buffer.from([65, 0, 66])); command(f.root, 'add', '.'); command(f.root, 'commit', '-m', 'binary'); const commit = command(f.root, 'rev-parse', 'HEAD').trim();
    await expect(f.git.version({ ...f.file, commit })).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await fs.writeFile(target, 'a'.repeat(2 * 1024 * 1024 + 1)); await expect(f.git.file(f.file)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
  it('rejects revision expressions, traversal and additional IPC fields', () => {
    const scope = { requestId: 'test', workspaceId: 'test', workspaceEpoch: 1 }, input = { ...scope, relativePath: 'a.adoc', commit: 'a'.repeat(40) };
    expect(() => validate('gitVersion', input)).not.toThrow();
    for (const override of [{ commit: 'HEAD' }, { commit: '--help' }, { relativePath: '../a.adoc' }, { relativePath: '.git/a.adoc' }, { command: 'reset' }]) expect(() => validate('gitVersion', { ...input, ...override })).toThrow();
  });
  it('rejects historical symbolic links and keeps Git failure separate from document reading', async () => {
    const f = await fixture(), target = path.join(f.root, f.file.relativePath);
    await fs.writeFile(target, '= Plain'); const blob = command(f.root, 'hash-object', '-w', '--', f.file.relativePath).trim();
    command(f.root, 'update-index', '--add', '--cacheinfo', `120000,${blob},${f.file.relativePath}`); command(f.root, 'commit', '-m', 'link');
    await expect(f.git.version({ ...f.file, commit: command(f.root, 'rev-parse', 'HEAD').trim() })).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    const savedPath = process.env.PATH;
    try { process.env.PATH = path.join(f.root, 'missing-bin'); await expect(f.git.status(f.scope)).rejects.toThrow('Git 실행 파일'); expect((await f.workspace.read(f.file)).text).toBe('= Plain'); }
    finally { process.env.PATH = savedPath; }
  });
  it('bounds diff output and distinguishes missing from empty content', () => {
    expect(textDiff('a\nb\nc', 'a\nx\nc')).toContain('- b\n+ x'); expect(textDiff(undefined, '')).toContain('+ ');
    expect(textDiff('a\r\n', 'a\n')).toContain('차이가 없습니다');
    expect(textDiff('', Array.from({ length: 500 }, (_, i) => `${i}`).join('\n'))).toContain('150줄 이후 생략');
  });
});

import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, createWorkspaceFolder, fileError } from './index';
import { Recents } from './recents';
import { validate } from '@metis/contracts';
const roots: string[] = [];
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-01-')); roots.push(root);
  return { root, recents: new Recents(path.join(root, 'profile', 'recents.json')) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-01-')) throw new Error('Invalid cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
});
test.each(['../escape', '', 'CON', 'a/b', 'a\\b', 'name.', ' name', 'a:b'])('rejects unsafe new folder name %s', name => {
  expect(() => validate('createWorkspace', { requestId: 'create', name })).toThrow();
});
test('new workspace is empty; duplicate creation preserves existing content', async () => {
  const { root } = await setup();
  const target = await createWorkspaceFolder(root, '한글 작업 공간');
  expect(await fs.readdir(target)).toEqual([]);
  await fs.writeFile(path.join(target, 'note.adoc'), 'original');
  await expect(createWorkspaceFolder(root, '한글 작업 공간')).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readFile(path.join(target, 'note.adoc'), 'utf8')).toBe('original');
});
test('creates nested folder only within active scope', async () => {
  const { root } = await setup(); const workspace = new Workspace();
  const session = await workspace.open(root);
  const request = { ...session, requestId: 'create', relativePath: '', name: 'child' };
  expect(await workspace.createDirectory(request)).toMatchObject({ relativePath: 'child', kind: 'directory' });
  await workspace.open(root);
  await expect(workspace.createDirectory({ ...request, name: 'stale' })).rejects.toMatchObject({ code: 'STALE_WORKSPACE' });
  expect(await fs.readdir(root)).toEqual(['child']);
});
test('read-only detection preserves opening; inaccessible switch preserves prior session', async () => {
  const { root } = await setup(); const workspace = new Workspace();
  const originalAccess = fs.access.bind(fs);
  vi.spyOn(fs, 'access').mockImplementation(async (p, mode) => {
    if (mode === constants.W_OK) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return originalAccess(p, mode);
  });
  const session = await workspace.open(root); expect(session.readOnly).toBe(true);
  const spy = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(workspace.open(root)).rejects.toMatchObject({ code: 'EACCES' }); spy.mockRestore();
  expect(await workspace.list({ ...session, requestId: 'list', relativePath: '' })).toEqual([]);
  expect(fileError({ code: 'EROFS' })).toMatchObject({ code: 'ACCESS_DENIED' });
  expect(fileError({ code: 'EACCES' })).toMatchObject({ code: 'ACCESS_DENIED' });
});
test('recent order, deduplication and removal survive restart without touching folders', async () => {
  const { root, recents } = await setup();
  const a = await createWorkspaceFolder(root, 'a'), b = await createWorkspaceFolder(root, 'b');
  await Promise.all([recents.record(a), recents.record(b)]);
  const first = await recents.list(); expect(first.entries.map(e => e.name)).toEqual(['b', 'a']);
  const id = first.entries[1].id; await recents.record(a);
  const reloaded = new Recents(path.join(root, 'profile', 'recents.json'));
  expect((await reloaded.list()).entries.map(e => e.name)).toEqual(['a', 'b']);
  expect(await reloaded.resolve(id)).toBe(a);
  await reloaded.remove(id);
  expect((await reloaded.list()).entries.map(e => e.name)).toEqual(['b']);
  expect(await fs.readdir(a)).toEqual([]);
});
test('missing recent location remains removable; injected path cannot be opened as a recent ID', async () => {
  const { root, recents } = await setup(); const target = await createWorkspaceFolder(root, 'moved');
  await recents.record(target); await fs.rename(target, path.join(root, 'new-location'));
  expect((await recents.list()).entries[0].state).toBe('missing');
  await expect(recents.resolve('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(() => validate('openRecentWorkspace', { requestId: 'x', recentId: 'x', path: root })).toThrow();
});
test('corrupt recent history is preserved and produces a recoverable warning', async () => {
  const { root, recents } = await setup(); await fs.mkdir(path.join(root, 'profile'));
  const file = path.join(root, 'profile', 'recents.json'); await fs.writeFile(file, 'broken');
  expect((await recents.list()).warning).toBeTruthy();
  await expect(recents.record(root)).rejects.toThrow();
  expect(await fs.readFile(file, 'utf8')).toBe('broken');
});

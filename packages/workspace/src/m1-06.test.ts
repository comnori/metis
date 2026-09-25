import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace, Recovery } from './index';
import { validate } from '@metis/contracts';
const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-06-')); roots.push(root); const recoveryRoot = path.join(root, 'recovery'); const workspaceRoot = path.join(root, 'workspace'); await fs.mkdir(workspaceRoot); const workspace = new Workspace(recoveryRoot); const session = await workspace.open(workspaceRoot); const scope = { requestId: 'test', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch }; return { root, recoveryRoot, workspaceRoot, workspace, scope, recovery: new Recovery(recoveryRoot) }; }
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-06-')) throw new Error('Cleanup boundary'); await fs.rm(root, { recursive: true, force: true }); } });
test('draft survives service restart and missing source parent; restore never overwrites', async () => {
  const f = await fixture();
  const id = await f.workspace.checkpoint({ ...f.scope, relativePath: 'deleted/note.adoc', text: 'unsaved 한글' });
  const recovery = new Recovery(f.recoveryRoot);
  expect((await recovery.list(f.workspaceRoot)).entries[0]).toMatchObject({ id, state: 'draft', relativePath: 'deleted/note.adoc' });
  const content = await recovery.read(f.workspaceRoot, id, 'edited');
  await f.workspace.copy({ ...f.scope, relativePath: '', name: 'restored.adoc', text: content.text });
  await expect(f.workspace.copy({ ...f.scope, relativePath: '', name: 'restored.adoc', text: 'overwrite' })).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readFile(path.join(f.workspaceRoot, 'restored.adoc'), 'utf8')).toBe('unsaved 한글');
});
test('completed save records expose byte-preserving versions and isolate workspaces', async () => {
  const f = await fixture(), file = path.join(f.workspaceRoot, 'note.adoc');
  await fs.writeFile(file, '\uFEFFbefore\r\n'); const before = await f.workspace.read({ ...f.scope, relativePath: 'note.adoc' });
  await f.workspace.save({ ...f.scope, relativePath: 'note.adoc', revision: before.revision, text: 'after\n' });
  const list = await f.recovery.list(f.workspaceRoot); expect(list.entries[0].state).toBe('saved');
  const original = await f.recovery.read(f.workspaceRoot, list.entries[0].id, 'before'); expect(original.text).toBe('\uFEFFbefore\r\n');
  await f.workspace.copy({ ...f.scope, relativePath: '', name: 'before.adoc', text: original.text });
  expect(await fs.readFile(path.join(f.workspaceRoot, 'before.adoc'))).toEqual(Buffer.from('\uFEFFbefore\r\n'));
  expect((await f.recovery.list(path.join(f.root, 'other'))).entries).toEqual([]);
  await expect(f.recovery.read(path.join(f.root, 'other'), list.entries[0].id, 'edited')).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' });
});
test('malformed metadata and symlinked recovery records are excluded', async () => {
  const f = await fixture(), id = await f.workspace.checkpoint({ ...f.scope, relativePath: 'note.adoc', text: 'draft' });
  await fs.writeFile(path.join(f.recoveryRoot, id, 'transaction.json'), '{broken');
  await fs.symlink(f.workspaceRoot, path.join(f.recoveryRoot, 'draft-link'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(await f.recovery.list(f.workspaceRoot)).toMatchObject({ entries: [], warning: expect.any(String) });
  await expect(f.recovery.read(f.workspaceRoot, 'draft-link', 'edited')).rejects.toThrow();
});
test('reviewed revision cannot overwrite a later external change', async () => {
  const f = await fixture(), file = path.join(f.workspaceRoot, 'note.adoc');
  await fs.writeFile(file, 'reviewed'); const disk = await f.workspace.read({ ...f.scope, relativePath: 'note.adoc' });
  await fs.writeFile(file, 'new external');
  await expect(f.workspace.save({ ...f.scope, relativePath: 'note.adoc', revision: disk.revision, text: 'resolution' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(file, 'utf8')).toBe('new external');
});
test.each([{ recoveryId: '../escape', variant: 'edited' }, { recoveryId: 'draft-test', variant: '../transaction' }])('rejects arbitrary recovery paths', extra => {
  expect(() => validate('readRecovery', { requestId: 'test', workspaceId: 'work', workspaceEpoch: 1, ...extra })).toThrow();
});

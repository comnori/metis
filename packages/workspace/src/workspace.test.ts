import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, fileError } from './index';
import { validate, failure } from '@metis/contracts';
const roots: string[] = [];
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-pre04-')); roots.push(root);
  const workspace = new Workspace(); const session = await workspace.open(root);
  return { root, workspace, request: { requestId: 'test', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: 'note.adoc' } };
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
test.each(['../outside.adoc', '/outside.adoc', 'C:/file.adoc', 'a\\b.adoc', 'a//b.adoc', 'a/./b.adoc', 'x\0.adoc'])('rejects invalid path %s', relativePath => {
  expect(() => validate('readDocument', { requestId: 'test', workspaceId: 'workspace', workspaceEpoch: 1, relativePath })).toThrow();
});
test('rejects missing and extra IPC fields', () => {
  expect(() => validate('runtime', {})).toThrow();
  expect(() => validate('openWorkspace', { requestId: 'test', root: 'C:/' })).toThrow();
  expect(validate('runtime', { requestId: 'test' })).toEqual({ requestId: 'test' });
});
test('reads UTF-8 BOM CRLF without changing bytes; lists only supported files', async () => {
  const { root, workspace, request } = await setup();
  const bytes = Buffer.from('\uFEFF= 한글\r\n본문');
  await fs.writeFile(path.join(root, 'note.adoc'), bytes);
  await fs.writeFile(path.join(root, 'hidden.txt'), 'other');
  expect(await workspace.list({ ...request, relativePath: '' })).toHaveLength(1);
  expect(await workspace.read(request)).toMatchObject({ text: '= 한글\r\n본문', bom: true, eol: 'crlf', byteLength: bytes.length });
  expect(await fs.readFile(path.join(root, 'note.adoc'))).toEqual(bytes);
});
test('distinguishes CR and mixed newlines', async () => {
  const { root, workspace, request } = await setup();
  await fs.writeFile(path.join(root, 'note.adoc'), 'a\rb');
  expect((await workspace.read(request)).eol).toBe('cr');
  await fs.writeFile(path.join(root, 'note.adoc'), 'a\rb\n');
  expect((await workspace.read(request)).eol).toBe('mixed');
});
test('rejects stale sessions and reports closed workspace', async () => {
  const { root, workspace, request } = await setup();
  const next = await workspace.open(root);
  await expect(workspace.list({ ...request, relativePath: '' })).rejects.toMatchObject({ code: 'STALE_WORKSPACE' });
  workspace.close({ ...next, requestId: 'close' });
  await expect(workspace.read(request)).rejects.toMatchObject({ code: 'NO_WORKSPACE' });
});
test('failed folder switch retains the existing session', async () => {
  const { root, workspace, request } = await setup();
  await expect(workspace.open(path.join(root, 'missing'))).rejects.toThrow();
  expect(await workspace.list({ ...request, relativePath: '' })).toEqual([]);
});
test('rejects a junction outside the workspace', async () => {
  const a = await setup(), b = await setup();
  await fs.writeFile(path.join(b.root, 'note.adoc'), 'outside');
  await fs.symlink(b.root, path.join(a.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(a.workspace.read({ ...a.request, relativePath: 'link/note.adoc' })).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' });
});
test.each([Buffer.from([0xff]), Buffer.from('binary\0data')])('rejects unsupported bytes', async bytes => {
  const { root, workspace, request } = await setup();
  await fs.writeFile(path.join(root, 'note.adoc'), bytes);
  await expect(workspace.read(request)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
});
test('rejects oversized files and maps missing file errors without a host path', async () => {
  const { root, workspace, request } = await setup();
  try { await workspace.read(request); } catch (error) { expect(failure('test', fileError(error))).toMatchObject({ error: { code: 'NOT_FOUND' } }); }
  const handle = await fs.open(path.join(root, 'note.adoc'), 'w'); await handle.truncate(16 * 1024 * 1024 + 1); await handle.close();
  await expect(workspace.read(request)).rejects.toMatchObject({ code: 'TOO_LARGE' });
});

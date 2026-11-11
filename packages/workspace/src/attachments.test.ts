import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from './index';
import { Attachments, attachmentTarget, attachmentCanOpen } from './attachments';
import { validate } from '@metis/contracts';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-attachments-')); roots.push(root);
  await fs.mkdir(path.join(root, 'workspace')); const folder = path.join(root, 'workspace');
  await fs.writeFile(path.join(folder, 'note.adoc'), '= Note');
  const workspace = new Workspace(), session = await workspace.open(folder), service = new Attachments(workspace);
  return { root, folder, workspace, service, scope: { requestId: 'test', ...session, relativePath: 'note.adoc' } };
}
test('imports without overwriting, reuses internal files and keeps binary files out of document listings', async () => {
  const { root, folder, workspace, service, scope } = await setup();
  const source = path.join(root, '한 글.png'); await fs.writeFile(source, 'image');
  const result = await service.import({ ...scope, action: 'import', sources: [{ path: source }, { path: source }, { path: path.join(folder, 'note.adoc') }, { path: path.join(root, 'missing') }] });
  expect(result.files.map(f => f.relativePath)).toEqual(['assets/한 글.png', 'assets/한 글-1.png', 'note.adoc']);
  expect(result.errors).toHaveLength(1);
  expect(await workspace.list({ ...scope, relativePath: 'assets' })).toEqual([]);
  expect(await fs.readFile(path.join(folder, 'assets/한 글.png'), 'utf8')).toBe('image');
});
test('resources stream byte ranges and expire on release or workspace switch', async () => {
  const { folder, workspace, service, scope } = await setup();
  await fs.writeFile(path.join(folder, 'audio.wav'), '0123456789');
  const result = await service.register({ ...scope, action: 'register', targets: ['audio.wav'] }), url = result.resources[0].url!;
  const partial = await service.response(url, 'bytes=2-5');
  expect(partial.status).toBe(206); expect(partial.headers.get('content-range')).toBe('bytes 2-5/10'); expect(await partial.text()).toBe('2345');
  expect(await (await service.response(url, 'bytes=-3')).text()).toBe('789');
  expect((await service.response(url, 'bytes=50-')).status).toBe(416);
  expect((await service.response(url, 'bytes=0-1,5-6')).status).toBe(416);
  expect((await service.response(url, null, 'HEAD')).headers.get('content-length')).toBe('10');
  service.release(result.group!); expect((await service.response(url, null)).status).toBe(404);
  const second = await service.register({ ...scope, action: 'register', targets: ['audio.wav'] });
  await workspace.open(folder); expect((await service.response(second.resources[0].url!, null)).status).toBe(404);
});

test('reuses files selected through a workspace alias without accepting links inside it', async () => {
  const { root, folder, service, scope } = await setup();
  const alias = path.join(root, 'workspace-alias'), outside = path.join(root, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'external.png'), 'outside');
  await fs.symlink(folder, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await fs.symlink(outside, path.join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await service.import({ ...scope, action: 'import', sources: [
    { path: path.join(alias, 'note.adoc') }, { path: path.join(alias, 'linked', 'external.png') }
  ] });
  expect(result.files.map(file => file.relativePath)).toEqual(['note.adoc']);
  expect(result.errors).toHaveLength(1);
  expect(await fs.readdir(folder)).not.toContain('assets');
});
test('rejects remote, absolute, encoded escapes, missing files and junctions', async () => {
  const { root, folder, service, scope } = await setup();
  await fs.symlink(root, path.join(folder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await service.register({ ...scope, action: 'register', targets: ['https://example.com/p.png', '/etc/passwd', '..%2fsecret.png', 'outside/note.adoc', 'missing.png', '.git/config'] });
  expect(result.resources.every(r => r.error && !r.url)).toBe(true);
  expect(attachmentTarget('docs/note.adoc', '../assets/a%20한.png')).toBe('assets/a 한.png');
  expect(() => attachmentTarget('note.adoc', 'C:%5csecret')).toThrow();
});
test('validates clipboard bytes and opens only known passive file types', async () => {
  const { service, scope } = await setup();
  expect((await service.import({ ...scope, action: 'import', sources: [{ png: [1, 2] }] })).errors).toHaveLength(1);
  for (const name of ['x.exe', 'x.cmd', 'x.ps1', 'x.lnk', 'x.url', 'x.html', 'x.unknown']) expect(attachmentCanOpen(name)).toBe(false);
  expect(attachmentCanOpen('report.PDF')).toBe(true);
  const clean = { requestId: 'r', workspaceId: scope.workspaceId, workspaceEpoch: scope.workspaceEpoch, relativePath: 'note.adoc' };
  expect(() => validate('attachments', { ...clean, action: 'import', sources: [{ path: 'x', png: [] }] })).toThrow();
  expect(() => validate('attachments', { ...clean, action: 'register', targets: [1] })).toThrow();
  expect(() => validate('attachments', { ...clean, action: 'open', token: 'abc', reveal: false })).not.toThrow();
});

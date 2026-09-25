import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from './index';
import { validate } from '@metis/contracts';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const roots: string[] = [];
async function setup(text = '= Original\nbody') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-02-')); roots.push(root);
  const folder = path.join(root, 'workspace'); await fs.mkdir(folder);
  const file = path.join(folder, 'note.adoc'); await fs.writeFile(file, text);
  const recovery = path.join(root, 'recovery'); const workspace = new Workspace(recovery);
  const session = await workspace.open(folder); const request = { requestId: 'test', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: 'note.adoc' };
  const snapshot = await workspace.read(request);
  return { root, folder, file, recovery, workspace, request, snapshot, save: { ...request, revision: snapshot.revision, text: '= Edited\nbody' } };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-02-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});
test.each(['\uFEFF= A\r\nbody  ', '= A\nbody\n', '= A\rbody', '= A'])('preserves encoding and newline convention %j', async original => {
  const s = await setup(original);
  const text = original.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n') + '!';
  const saved = await s.workspace.save({ ...s.save, text });
  expect(await fs.readFile(s.file, 'utf8')).toBe(original + '!');
  expect(saved.revision).not.toBe(s.snapshot.revision);
  const transaction = path.join(s.recovery, (await fs.readdir(s.recovery))[0]);
  expect(await fs.readFile(path.join(transaction, 'before.adoc'), 'utf8')).toBe(original);
  expect(await fs.readFile(path.join(transaction, 'edited.adoc'), 'utf8')).toBe(original + '!');
});
test('unchanged save leaves bytes and inode metadata alone', async () => {
  const s = await setup('\uFEFF= A\r\nbody'); const before = await fs.stat(s.file);
  await s.workspace.save({ ...s.save, text: '= A\nbody' });
  expect((await fs.stat(s.file)).mtimeMs).toBe(before.mtimeMs);
});
test('external edits and deletion do not get overwritten', async () => {
  const s = await setup(); await fs.writeFile(s.file, 'external');
  await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(s.file, 'utf8')).toBe('external');
  await fs.unlink(s.file); await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('a change in the final rename window is restored and archived', async () => {
  const s = await setup(); const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (from === s.file) await fs.writeFile(s.file, 'last-moment external'); return rename(from, to); });
  await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(s.file, 'utf8')).toBe('last-moment external');
  const tx = path.join(s.recovery, (await fs.readdir(s.recovery))[0]);
  expect(await fs.readFile(path.join(tx, 'displaced.adoc'), 'utf8')).toBe('last-moment external');
});
test('a concurrent creator is never replaced by publication or rollback', async () => {
  const s = await setup(); const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
    if (String(from).endsWith('.tmp')) await fs.writeFile(s.file, 'concurrent creator', { flag: 'wx' });
    return link(from, to);
  });
  await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(s.file, 'utf8')).toBe('concurrent creator');
  const displaced = (await fs.readdir(s.folder)).find(name => name.endsWith('.original'))!;
  expect(await fs.readFile(path.join(s.folder, displaced), 'utf8')).toBe(s.snapshot.text);
});
test('publication failure restores the original and keeps edited bytes', async () => {
  const s = await setup(); const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => { if (String(from).endsWith('.tmp')) throw Object.assign(new Error('locked'), { code: 'EPERM' }); return link(from, to); });
  await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'EPERM' });
  expect(await fs.readFile(s.file, 'utf8')).toBe(s.snapshot.text);
  const tx = path.join(s.recovery, (await fs.readdir(s.recovery))[0]);
  expect(await fs.readFile(path.join(tx, 'edited.adoc'), 'utf8')).toBe(s.save.text);
});
test('recovery write failure leaves the source untouched', async () => {
  const s = await setup(); await fs.writeFile(s.recovery, 'not a directory');
  await expect(s.workspace.save(s.save)).rejects.toThrow();
  expect(await fs.readFile(s.file, 'utf8')).toBe(s.snapshot.text);
});
test('mixed newlines are refused without normalization', async () => {
  const s = await setup('a\r\nb\nc');
  await expect(s.workspace.save(s.save)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(await fs.readFile(s.file, 'utf8')).toBe('a\r\nb\nc');
});
test('new document creation is exclusive and returns a save baseline', async () => {
  const s = await setup();
  const created = await s.workspace.createDocument({ ...s.request, relativePath: '', name: 'new.adoc' });
  expect(created.text).toBe('');
  await expect(s.workspace.createDocument({ ...s.request, relativePath: '', name: 'note.adoc' })).rejects.toMatchObject({ code: 'EEXIST' });
});
test('save schema rejects invalid revision, NUL, CR and unpaired surrogate', async () => {
  const s = await setup();
  expect(validate('saveDocument', s.save)).toEqual(s.save);
  for (const text of ['a\0', 'a\r', '\uD800']) expect(() => validate('saveDocument', { ...s.save, text })).toThrow();
  expect(() => validate('saveDocument', { ...s.save, revision: 'unknown' })).toThrow();
});
test('process exit after displacing the source retains both versions and a restorable original', async () => {
  const s = await setup();
  await build({ configFile: false, logLevel: 'silent', build: { target: 'node24', outDir: path.join(s.root, 'bundle'),
    lib: { entry: path.resolve('packages/workspace/src/save.ts'), formats: ['cjs'], fileName: () => 'save.cjs' },
    rolldownOptions: { external: [/^node:/] } } });
  const program = path.join(s.root, 'crash.cjs');
  await fs.writeFile(program, `const fs = require('node:fs').promises;
const { guardedSave } = require('./bundle/save.cjs');
const rename = fs.rename.bind(fs);
fs.rename = async (...args) => { await rename(...args); process.exit(73); };
guardedSave(${JSON.stringify(s.file)}, ${JSON.stringify(s.snapshot.revision)}, Buffer.from('edited before crash'), ${JSON.stringify(s.recovery)}, async () => {}).catch(() => process.exit(74));`);
  await expect(promisify(execFile)(process.execPath, [program], { windowsHide: true })).rejects.toMatchObject({ code: 73 });
  const transaction = path.join(s.recovery, (await fs.readdir(s.recovery))[0]);
  expect(await fs.readFile(path.join(transaction, 'before.adoc'), 'utf8')).toBe(s.snapshot.text);
  expect(await fs.readFile(path.join(transaction, 'edited.adoc'), 'utf8')).toBe('edited before crash');
  const journal = JSON.parse(await fs.readFile(path.join(transaction, 'transaction.json'), 'utf8'));
  expect(path.dirname(journal.displaced)).toBe(s.folder);
  await fs.link(journal.displaced, s.file);
  expect(await fs.readFile(s.file, 'utf8')).toBe(s.snapshot.text);
}, 15000);

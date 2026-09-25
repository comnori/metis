import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildRelations } from './relations';
import { Workspace } from '@metis/workspace';
import { validate } from '@metis/contracts';
const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m2-01-')); roots.push(root);
  for (const [name, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), text); }
  return root;
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m2-01-')) throw Error('Cleanup boundary');
  await fs.rm(root, { recursive: true, force: true });
} });
test('relations preserve evidence, revisions, backlinks and missing targets', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\nxref:b.adoc#target[Target]\n\nxref:gone.adoc[]', 'b.adoc': '[[target]]\n== Target\n\nBody' });
  const result = await buildRelations(root);
  expect(result.edges).toContainEqual(expect.objectContaining({ documentPath: 'a.adoc', relativePath: 'a.adoc', line: 3, targetPath: 'b.adoc', state: 'resolved', revision: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  expect(result.edges).toContainEqual(expect.objectContaining({ targetPath: 'gone.adoc', state: 'missing' }));
  expect(result.scanned).toBe(2);
});
test('shared source relations retain separate inherited conditions', async () => {
  const root = await fixture({ 'internal.adoc': '= Internal\n:internal:\n\ninclude::shared.adoc[]', 'public.adoc': '= Public\n\ninclude::shared.adoc[]', 'shared.adoc': 'ifdef::internal[]\nxref:target.adoc[]\nendif::[]', 'target.adoc': '= Target' });
  const result = await buildRelations(root);
  const references = result.edges.filter(edge => edge.kind === 'xref');
  expect(references).toHaveLength(1);
  expect(references[0]).toMatchObject({ documentPath: 'internal.adoc', relativePath: 'shared.adoc', targetPath: 'target.adoc' });
});
test('nested include keeps all affected root contexts', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\ninclude::b.adoc[]', 'b.adoc': 'include::c.adoc[]', 'c.adoc': 'shared body' });
  const result = await buildRelations(root);
  expect(result.edges.filter(edge => edge.kind === 'include' && edge.targetPath === 'c.adoc').map(edge => edge.documentPath).sort()).toEqual(['a.adoc', 'b.adoc']);
});
test('rebuild removes obsolete edges after edits and deletion without changing source', async () => {
  const root = await fixture({ 'a.adoc': 'xref:b.adoc[]', 'b.adoc': '= B' });
  expect((await buildRelations(root)).edges[0].state).toBe('resolved');
  await fs.unlink(path.join(root, 'b.adoc'));
  expect((await buildRelations(root)).edges[0].state).toBe('missing');
  await fs.writeFile(path.join(root, 'a.adoc'), '= Replaced');
  expect((await buildRelations(root)).edges).toEqual([]);
  expect(await fs.readFile(path.join(root, 'a.adoc'), 'utf8')).toBe('= Replaced');
});
test('code literals and inactive references are not indexed', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\n----\nxref:code.adoc[]\n----\n\nifdef::absent[]\nxref:hidden.adoc[]\nendif::[]' });
  expect((await buildRelations(root)).edges).toEqual([]);
});
test('outside paths and directory links cannot become local targets', async () => {
  const root = await fixture({ 'a.adoc': 'include::../outside.adoc[]\n\nxref:https://example.test/file.adoc[]' }), outside = await fixture({ 'secret.adoc': 'secret' });
  await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await buildRelations(root);
  expect(result.documents).not.toContain('escape/secret.adoc');
  expect(result.edges.every(edge => edge.targetPath === undefined && edge.state === 'blocked')).toBe(true);
});
test('bounded analysis reports partial results', async () => {
  const root = await fixture(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`${i}.adoc`, '= Document'])));
  const result = await buildRelations(root);
  expect(result.scanned).toBe(50); expect(result.partial).toBe(true); expect(result.warnings.join(' ')).toContain('50개');
});
test('revision change during a rebuild rejects mixed results', async () => {
  const root = await fixture({ 'a.adoc': '= A' });
  const original = Workspace.prototype.read; let count = 0;
  vi.spyOn(Workspace.prototype, 'read').mockImplementation(async function (this: Workspace, request) {
    if (++count === 2) await fs.writeFile(path.join(root, 'a.adoc'), '= Changed');
    return original.call(this, request);
  });
  await expect(buildRelations(root)).rejects.toMatchObject({ code: 'CONFLICT' });
});
test('relation IPC validates session and rejects extra fields', () => {
  for (const method of ['workspaceRelations', 'cancelRelations'] as const) {
    expect(() => validate(method, { requestId: 'test', workspaceId: 'space', workspaceEpoch: 1 })).not.toThrow();
    expect(() => validate(method, { requestId: 'test', workspaceId: 'space', workspaceEpoch: 0 })).toThrow();
    expect(() => validate(method, { requestId: 'test', workspaceId: 'space', workspaceEpoch: 1, root: 'outside' })).toThrow();
  }
});

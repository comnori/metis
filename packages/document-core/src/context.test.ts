import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '@metis/workspace';
import { validate, type ContextRequest } from '@metis/contracts';
import { buildContext } from './context';
const roots: string[] = [];
const request = (paths = ['a.adoc'], documents = ['a.adoc']): ContextRequest => ({ requestId: 'context', workspaceId: 'test', workspaceEpoch: 1, paths, roots: documents });
async function fixture(files: Record<string, string>) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-context-')); roots.push(root); for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(root, name), text); return root; }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('metis-context-')) await fs.rm(root, { recursive: true, force: true }); });
test('context IPC rejects hidden scope expansion and allows literal spaced paths', () => {
  expect(() => validate('buildContext', request(['a b.adoc'], ['a b.adoc']))).not.toThrow();
  for (const value of [request([], []), request(['../a.adoc']), request(['/a.adoc']), request(['.git/a.adoc']), request(['a.adoc', 'a.adoc']), request(['a.adoc'], ['b.adoc']), request(Array.from({ length: 17 }, (_, i) => `${i}.adoc`)), { ...request(), transport: 'remote' }, { ...request(), roots: Array(5).fill('a.adoc') }]) expect(() => validate('buildContext', value)).toThrow();
});
test('unselected includes and xrefs never read target content or enumerate workspace', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\ninclude::private.adoc[]\n\nxref:private.adoc[]', 'private.adoc': 'PRIVATE SECRET' });
  const read = vi.spyOn(Workspace.prototype, 'read'), list = vi.spyOn(Workspace.prototype, 'list');
  const bundle = await buildContext(root, request());
  expect(read.mock.calls.map(([r]) => r.relativePath)).toEqual(['a.adoc', 'a.adoc']); expect(list).not.toHaveBeenCalled();
  expect(JSON.stringify(bundle)).not.toContain('PRIVATE SECRET');
  expect(bundle.documents[0].model.relations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'include', state: 'blocked' }), expect.objectContaining({ kind: 'xref', state: 'unchecked' })]));
  expect(bundle.transport).toBe('local-only'); expect(bundle.sources[0].revision).toMatch(/^[a-f0-9]{64}$/);
});
test('shared fragment retains distinct parent attributes, conditional state and original tag line', async () => {
  const root = await fixture({ 'a.adoc': '= A\n:edition: public\n:public:\n\ninclude::shared.adoc[tag=body]', 'b.adoc': '= B\n:edition: internal\n\ninclude::shared.adoc[tag=body]', 'shared.adoc': '// tag::body[]\n== Shared\n\n{edition}\n\nifdef::public[]\nVisible publicly\nendif::[]\n// end::body[]\nUNSELECTED TAG CONTENT' });
  const result = await buildContext(root, request(['a.adoc', 'b.adoc', 'shared.adoc'], ['a.adoc', 'b.adoc']));
  const [a, b] = result.documents;
  expect(a.model.attributeUses).toContainEqual(expect.objectContaining({ name: 'edition', value: 'public', relativePath: 'shared.adoc', line: 4 }));
  expect(b.model.attributeUses).toContainEqual(expect.objectContaining({ name: 'edition', value: 'internal' }));
  expect(a.model.conditions[0].state).toBe('active'); expect(b.model.conditions[0].state).toBe('inactive');
  expect(a.blocks).toContainEqual(expect.objectContaining({ kind: 'section', relativePath: 'shared.adoc', line: 2 }));
  expect(a.blocks.some(item => item.text.includes('Visible publicly'))).toBe(true); expect(b.blocks.some(item => item.text.includes('Visible publicly'))).toBe(false);
  expect(JSON.stringify(a)).not.toContain('UNSELECTED TAG CONTENT'); expect(result.sources.find(item => item.relativePath === 'shared.adoc')!.text).toContain('UNSELECTED TAG CONTENT');
  expect('html' in a.model).toBe(false);
});
test('context preserves source bytes and rejects changed revisions during composition', async () => {
  const original = '\uFEFF= A\r\n\r\nBody  ', root = await fixture({ 'a.adoc': original });
  const before = await fs.readFile(path.join(root, 'a.adoc'));
  await buildContext(root, request()); expect(await fs.readFile(path.join(root, 'a.adoc'))).toEqual(before);
  const read = Workspace.prototype.read; let count = 0;
  vi.spyOn(Workspace.prototype, 'read').mockImplementation(async function(this: Workspace, r) { const result = await read.call(this, r); if (++count === 2) return { ...result, revision: '0'.repeat(64) }; return result; });
  await expect(buildContext(root, request())).rejects.toMatchObject({ code: 'CHANGED_DURING_READ' });
});
test('selected symlink outside workspace cannot enter a bundle', async () => {
  const root = await fixture({ 'a.adoc': '= A' }); const outside = await fixture({ 'secret.adoc': 'SECRET' });
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(buildContext(root, request(['linked/secret.adoc'], ['linked/secret.adoc']))).rejects.toThrow();
});
test('oversized source fails explicitly rather than truncating meaning', async () => {
  const root = await fixture({ 'a.adoc': 'a'.repeat(1024 * 1024 + 1) });
  await expect(buildContext(root, request())).rejects.toMatchObject({ code: 'TOO_LARGE' });
});

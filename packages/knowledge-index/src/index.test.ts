import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { search } from './index';
import { validate, type SearchRequest } from '@metis/contracts';
const roots: string[] = [];
const request: SearchRequest = { requestId: 'search', workspaceId: 'workspace', workspaceEpoch: 1, query: 'needle', mode: 'text', caseSensitive: false };
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-05-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-05-')) throw new Error('Invalid cleanup');
  await fs.rm(root, { recursive: true, force: true });
} });
test('literal body matches preserve line numbers, snippets, revisions, case and CRLF', async () => {
  const root = await fixture(); await fs.writeFile(path.join(root, 'note.adoc'), '= Test\r\n\r\nNeedle\r\nneedle [a.*]');
  const result = await search(root, request);
  expect(result.hits.map(hit => hit.line)).toEqual([3, 4]);
  expect(result.hits[0].revision).toMatch(/^[a-f0-9]{64}$/); expect(result.partial).toBe(false);
  expect((await search(root, { ...request, caseSensitive: true })).hits.map(hit => hit.line)).toEqual([4]);
  expect((await search(root, { ...request, query: '[a.*]' })).hits[0].context).toBe('needle [a.*]');
});
test('quick open includes nested paths and excludes hidden and non-AsciiDoc files', async () => {
  const root = await fixture(); await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs/a.adoc'), ''); await fs.writeFile(path.join(root, '.hidden.adoc'), ''); await fs.writeFile(path.join(root, 'other.txt'), '');
  expect((await search(root, { ...request, mode: 'files', query: '' })).hits.map(hit => hit.relativePath)).toEqual(['docs/a.adoc']);
  expect((await search(root, { ...request, mode: 'files', query: 'docs/' })).hits).toHaveLength(1);
});
test('semantic search finds sections, anchor IDs and applied attribute declarations', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'note.adoc'), '= Main\n:needle: public\n\n[[needle-anchor]]\n== Needle section\n\nifdef::absent[]\n:needle-hidden: no\n\n== Needle hidden\nendif::[]\n\n----\n[[needle-code]]\n----');
  const result = await search(root, { ...request, mode: 'symbols' });
  expect(result.hits.map(hit => hit.kind).sort()).toEqual(['anchor', 'attribute', 'section']);
  expect(result.hits.every(hit => hit.revision && hit.relativePath === 'note.adoc')).toBe(true);
  expect(result.hits.find(hit => hit.kind === 'attribute')?.line).toBe(2);
});
test('included symbols are searched at their declaration file once per kind', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'main.adoc'), '= Main\n\ninclude::part.adoc[]');
  await fs.writeFile(path.join(root, 'part.adoc'), '== Needle');
  const result = await search(root, { ...request, mode: 'symbols' });
  expect(result.hits.filter(hit => hit.kind === 'section').map(hit => `${hit.relativePath}:${hit.line}`)).toEqual(['part.adoc:1']);
  expect(result.hits.every(hit => hit.relativePath === 'part.adoc')).toBe(true);
});
test('unreadable text and limits yield explicit partial results', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'bad.adoc'), Buffer.from([0xff, 0xfe, 0x00]));
  await fs.writeFile(path.join(root, 'many.adoc'), Array(520).fill('needle').join('\n'));
  const result = await search(root, request);
  expect(result.hits).toHaveLength(500); expect(result.partial).toBe(true); expect(result.warnings.join(' ')).toContain('bad.adoc');
});
test('subsequent searches read saved changes without stale cache', async () => {
  const root = await fixture(), file = path.join(root, 'note.adoc');
  await fs.writeFile(file, 'needle'); const first = await search(root, request);
  await fs.writeFile(file, 'changed'); const second = await search(root, request);
  expect(first.hits).toHaveLength(1); expect(second.hits).toHaveLength(0); expect(second.partial).toBe(false);
});
test('junctions cannot expose files outside the workspace', async () => {
  const root = await fixture(), outside = await fixture();
  await fs.writeFile(path.join(outside, 'secret.adoc'), 'needle');
  await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await search(root, request)).hits).toEqual([]);
});
test.each([{ query: '\n' }, { query: 'a'.repeat(201) }, { mode: 'regex' }, { root: 'C:/' }, { caseSensitive: 'false' }])('rejects malformed search payload %j', extra => {
  expect(() => validate('searchDocuments', { ...request, ...extra })).toThrow();
});

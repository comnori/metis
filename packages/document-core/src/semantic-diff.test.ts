import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '@metis/workspace';
import { validate, type SemanticDiffRequest } from '@metis/contracts';
import { semanticDiff } from './semantic-diff';
const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-semantic-')); roots.push(root); return root; }
const request = (before: string, after: string): SemanticDiffRequest => ({ requestId: 'diff', workspaceId: 'test', workspaceEpoch: 1, relativePath: 'a.adoc', before, after });
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('metis-semantic-')) await fs.rm(root, { recursive: true, force: true }); });
test('compares stable section IDs, attributes and blocks with both source positions', async () => {
  const result = await semanticDiff(await fixture(), request('= Before\n:product: Old\n\n[[stable]]\n== Old\n\nBody', '= After\n:product: New\n\n[[stable]]\n== New\n\nChanged body'));
  for (const category of ['section', 'attribute', 'block']) expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'modified', before: expect.objectContaining({ category }), after: expect.objectContaining({ category }) }));
  expect(result.changes.find(c => c.after?.key.startsWith('section:stable'))?.after?.line).toBe(5);
  expect(result.partial).toBe(false);
});
test('line shifts alone do not create structural changes', async () => {
  const result = await semanticDiff(await fixture(), request('= A\n\n== Section\n\nBody', '= A\n\n\n== Section\n\nBody'));
  expect(result.changes).toEqual([]);
});
test('include option changes are reported without reading present-day included files', async () => {
  const root = await fixture(); await fs.writeFile(path.join(root, 'part.adoc'), 'SECRET NOW');
  const read = vi.spyOn(Workspace.prototype, 'read'), list = vi.spyOn(Workspace.prototype, 'list');
  const result = await semanticDiff(root, request('= A\n\ninclude::part.adoc[tag=old]', '= A\n\ninclude::part.adoc[tag=new]'));
  expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'modified', after: expect.objectContaining({ category: 'include' }) }));
  expect(result.validation?.after?.issues.some(i => i.code === 'include-unchecked')).toBe(true); expect(read).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('SECRET NOW'); expect(result.partial).toBe(true);
});
test('changed reference targets and active conditions remain visible', async () => {
  const result = await semanticDiff(await fixture(), request('= A\n\nxref:old.adoc[]\n\nifdef::flag[]\nVisible\nendif::[]', '= A\n:flag:\n\nxref:new.adoc[]\n\nifdef::flag[]\nVisible\nendif::[]'));
  expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'removed', before: expect.objectContaining({ category: 'reference', value: 'old.adoc' }) }));
  expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'added', after: expect.objectContaining({ category: 'reference', value: 'new.adoc' }) }));
  expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'modified', after: expect.objectContaining({ category: 'condition' }) }));
});
test('one failed analysis never claims all nodes on the other side were removed', async () => {
  const result = await semanticDiff(await fixture(), request('가'.repeat(400000), '= A\n\nBody'));
  expect(result.validation?.before).toBeUndefined(); expect(result.validation?.after).toBeDefined(); expect(result.partial).toBe(true); expect(result.changes).toEqual([]); expect(result.warnings.some(w => w.includes('해석 실패'))).toBe(true);
});
test('IPC rejects oversized, malformed and escaping requests', () => {
  for (const value of [{ ...request('', ''), before: 'x'.repeat(1024 * 1024 + 1) }, { ...request('', ''), after: '\0' }, { ...request('', ''), relativePath: '../a.adoc' }, { ...request('', ''), relativePath: '.git/a.adoc' }, { ...request('', ''), extra: true }]) expect(() => validate('semanticDiff', value)).toThrow();
});

test('proposal validation compares actual selected text with M3-02 rules', async () => {
  const before = '= A\n\n[[target]]\n== Target\n\nxref:target[]\n\n{unknown}\n';
  const after = '= A\n:unknown: known\n\n== Renamed\n\nxref:target[]\n';
  const result = await semanticDiff(await fixture(), request(before, after));
  expect(result.validation?.before?.issues.some(i => i.code === 'undefined-attribute')).toBe(true);
  expect(result.validation?.before?.issues.some(i => i.code === 'missing-anchor')).toBe(false);
  expect(result.validation?.after?.issues.some(i => i.code === 'undefined-attribute')).toBe(false);
  expect(result.validation?.after?.issues.some(i => i.code === 'missing-anchor')).toBe(true);
});

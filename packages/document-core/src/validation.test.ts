import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '@metis/workspace';
import type { ContextDocument, ContextRequest } from '@metis/contracts';
import { buildContext } from './context';
import { validateContext } from './validation';
const roots: string[] = [];
const request = (paths: string[], documents = paths): ContextRequest => ({ requestId: 'validation', workspaceId: 'test', workspaceEpoch: 1, paths, roots: documents });
async function fixture(files: Record<string, string>) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-validation-')); roots.push(root); for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(root, name), text); return root; }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('metis-validation-')) await fs.rm(root, { recursive: true, force: true }); });
test('selected target anchors are checked without claiming unselected files are missing', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\nxref:b.adoc#good[] xref:b.adoc#missing[] xref:outside.adoc[]', 'b.adoc': '= B\n\n[[good]]\n== Good' });
  const read = vi.spyOn(Workspace.prototype, 'read');
  const result = await buildContext(root, request(['a.adoc', 'b.adoc']));
  expect(read.mock.calls.every(([r]) => ['a.adoc', 'b.adoc'].includes(r.relativePath))).toBe(true);
  expect(result.validation.checkedReferences).toBe(2);
  expect(result.validation.issues).toContainEqual(expect.objectContaining({ documentPath: 'a.adoc', certainty: 'confirmed', code: 'missing-anchor', line: 3 }));
  expect(result.validation.issues).toContainEqual(expect.objectContaining({ certainty: 'unchecked', code: 'outside-selection' }));
  expect(result.documents[0].model.relations.every(item => item.state === 'unchecked')).toBe(true);
});
test('included source references resolve in each parent context with evidence retained', async () => {
  const root = await fixture({ 'a.adoc': '= A\n:public:\n\ninclude::part.adoc[]', 'b.adoc': '= B\n\ninclude::part.adoc[]', 'part.adoc': 'ifdef::public[]\n[[public-anchor]]\n== Public\nendif::[]\n\n<<public-anchor>>' });
  const result = await buildContext(root, request(['a.adoc', 'b.adoc', 'part.adoc'], ['a.adoc', 'b.adoc']));
  const missing = result.validation.issues.filter(item => item.code === 'missing-anchor');
  expect(missing).toHaveLength(1); expect(missing[0]).toMatchObject({ documentPath: 'b.adoc', relativePath: 'part.adoc', line: 6 });
});
test('undefined attributes and parser structure diagnostics remain separate from AI opinions', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\n{unknown}\n\n==== Skipped' });
  const result = await buildContext(root, request(['a.adoc']));
  expect(result.validation.issues).toContainEqual(expect.objectContaining({ certainty: 'confirmed', category: 'attribute', code: 'undefined-attribute', line: 3 }));
  expect(result.validation.issues).toContainEqual(expect.objectContaining({ certainty: 'parser', category: 'structure' }));
  expect(result.validation.issues.filter(item => item.message.includes('unknown'))).toHaveLength(1);
  expect(result.validation.partial).toBe(true);
});
test('blocked includes and unanalyzed targets prevent false missing-anchor claims', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\nxref:b.adoc#absent[] xref:c.adoc#absent[]', 'b.adoc': '= B\n\ninclude::not-selected.adoc[]', 'c.adoc': '= C' });
  const result = await buildContext(root, request(['a.adoc', 'b.adoc', 'c.adoc'], ['a.adoc', 'b.adoc']));
  expect(result.validation.issues.map(item => item.code)).toEqual(expect.arrayContaining(['incomplete-target', 'target-not-analyzed', 'include-unchecked']));
  expect(result.validation.issues.some(item => item.code === 'missing-anchor')).toBe(false);
});
test('comments, literal examples and inactive branches do not become reference problems', async () => {
  const root = await fixture({ 'a.adoc': '= A\n\n// xref:comment.adoc[]\n\n----\nxref:literal.adoc[]\n{literal}\n----\n\nifdef::absent[]\nxref:inactive.adoc[]\nendif::[]' });
  const result = await buildContext(root, request(['a.adoc']));
  expect(result.validation.issues).toEqual([]); expect(result.validation.partial).toBe(false);
});
test('uncertain evidence and capped reports never masquerade as complete results', () => {
  const doc: ContextDocument = { documentPath: 'a.adoc', blocks: [], model: { outline: [], anchors: [], diagnostics: [], attributes: [], attributeUses: [], conditions: [], relations: [{ relativePath: 'part.adoc', line: 45, kind: 'xref', target: 'absent', state: 'unchecked', sourceUncertain: true }] } };
  const sources = [{ relativePath: 'a.adoc', revision: '0'.repeat(64), byteLength: 0, text: '' }];
  expect(validateContext({ sources, documents: [doc] }).issues[0]).toMatchObject({ certainty: 'unchecked', line: 1, sourceUncertain: true });
  doc.model.relations = []; doc.model.attributeUses = Array.from({ length: 1100 }, (_, i) => ({ relativePath: 'a.adoc', line: i + 1, name: `x${i}` }));
  const report = validateContext({ sources, documents: [doc] });
  expect(report.issues).toHaveLength(1000); expect(report.truncated).toBe(true); expect(report.partial).toBe(true);
});

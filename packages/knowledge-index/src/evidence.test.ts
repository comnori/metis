import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildContext } from '../../document-core/src/context';
import { findEvidence } from './evidence';
const roots: string[] = [];
async function bundle(files: Record<string, string>, selected = Object.keys(files), parents = selected) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-evidence-')); roots.push(root);
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(root, name), text);
  return buildContext(root, { requestId: 'evidence', workspaceId: 'test', workspaceEpoch: 1, paths: selected, roots: parents });
}
afterEach(async () => { for (const root of roots.splice(0)) if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('metis-evidence-')) await fs.rm(root, { recursive: true, force: true }); });

test('retrieval excludes unselected, inactive and tag-excluded text while retaining included provenance', async () => {
  const context = await bundle({ 'a.adoc': '= A\n\ninclude::part.adoc[tag=public]\n\ninclude::private.adoc[]\n\nifdef::absent[]\nINACTIVE\nendif::[]', 'part.adoc': '// tag::public[]\nEvidence public\n// end::public[]\n\nEXCLUDED', 'private.adoc': 'SECRET' }, ['a.adoc', 'part.adoc'], ['a.adoc']);
  for (const word of ['SECRET', 'INACTIVE', 'EXCLUDED']) expect(findEvidence(context, word).hits).toEqual([]);
  const hit = findEvidence(context, 'Evidence').hits[0];
  expect(hit).toMatchObject({ documentPath: 'a.adoc', relativePath: 'part.adoc', line: 2, kind: 'block' });
  expect(hit.revision).toBe(context.sources.find(item => item.relativePath === 'part.adoc')!.revision);
  expect(findEvidence(context, 'Evidence').warnings.join(' ')).toContain('불완전');
});
test('applied attribute differences are candidates, with each parent context preserved', async () => {
  const context = await bundle({ 'a.adoc': '= A\n:port: 80\n\nPort {port}', 'b.adoc': '= B\n:port: 443\n\nPort {port}' });
  const result = findEvidence(context, 'port');
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].evidence.map(item => item.documentPath)).toEqual(['a.adoc', 'b.adoc']);
  expect(result.warnings.join(' ')).toContain('모순으로 확정하지 않습니다');
});
test('references remain explicit declarations with unchecked target state', async () => {
  const context = await bundle({ 'a.adoc': '= A\n\nxref:target.adoc[]' });
  const result = findEvidence(context, 'target');
  expect(result.hits.some(item => item.kind === 'relation' && item.text.includes('unchecked'))).toBe(true);
  expect(context.documents[0].model.relations[0].state).toBe('unchecked');
});
test('normalization, ranked titles, missing terms and query bounds are explicit', async () => {
  const context = await bundle({ 'a.adoc': '= A\n\nBody Cache\n\n== CACHE\n\n설정 근거' });
  expect(findEvidence(context, 'ｃａｃｈｅ').hits[0].text).toBe('CACHE');
  expect(findEvidence(context, '설정 unknown').missingTerms).toEqual(['unknown']);
  expect(findEvidence(context, '!!!').hits).toEqual([]);
  expect(findEvidence(context, 'x'.repeat(301)).warnings).toContain('질의는 300자 이내로 입력하세요.');
});
test('result limits and excerpts do not mutate or persist snapshot data', async () => {
  const context = await bundle({ 'a.adoc': '= A\n\n' + Array.from({ length: 45 }, (_, i) => `match ${i}`).join('\n\n') + '\n\nmatch ' + 'x'.repeat(2500) });
  const before = JSON.stringify(context), result = findEvidence(context, 'match');
  expect(result.hits).toHaveLength(40); expect(result.truncated).toBe(true);
  expect(result.hits.every(item => item.text.length <= 2000)).toBe(true);
  expect(JSON.stringify(context)).toBe(before);
});

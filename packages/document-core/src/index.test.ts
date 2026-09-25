import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from './index';
const roots: string[] = [];
test('semantic references resolve actual anchors and saved target documents', async () => {
  const root = await fixture();
  const result = await analyze(root, 'main.adoc', '= Main\n:release:\n:product: Metis\n\n[[local]]\n== Local\n\n{product} <<local>> xref:shared/part.adoc#_shared_section[] <<missing>>\n\nifdef::absent[]\nxref:ghost.adoc[]\nendif::[]\n\n----\nxref:code.adoc[]\n----');
  expect(result.relations).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: 'local', state: 'resolved' }),
    expect.objectContaining({ target: 'shared/part.adoc#_shared_section', state: 'resolved', destination: expect.objectContaining({ relativePath: 'shared/part.adoc', line: 1 }) }),
    expect.objectContaining({ target: 'missing', state: 'missing' })
  ]));
  expect(result.relations).toHaveLength(3);
  expect(result.attributes).toContainEqual(expect.objectContaining({ name: 'product', value: 'Metis', applied: true }));
  expect(result.attributeUses).toContainEqual(expect.objectContaining({ name: 'product', value: 'Metis' }));
  expect(result.conditions).toContainEqual(expect.objectContaining({ state: 'inactive' }));
  expect(result.files).toContain('shared/part.adoc');
});
test('attribute context follows body overrides and inactive declarations', async () => {
  const root = await fixture();
  const result = await analyze(root, 'main.adoc', '= Context\n:edition: public\n\n{edition}\n\n:edition: internal\n\n{edition}\n\nifdef::absent[]\n:edition: hidden\nendif::[]\n\n{edition}\n\n:edition!:\n\n{edition}');
  expect(result.attributeUses.map(a => a.value)).toEqual(['public', 'internal', 'internal', undefined]);
  expect(result.attributes.find(a => a.value === 'hidden')?.applied).toBe(false);
  expect(result.attributes).toContainEqual(expect.objectContaining({ value: '(해제)', applied: true }));
});
test('reference failures distinguish missing and blocked targets with source locations', async () => {
  const root = await fixture();
  const result = await analyze(root, 'docs/main.adoc', 'xref:../shared/part.adoc#absent[] xref:missing.adoc[] xref:../../escape.adoc[]\n\ninclude::../shared/part.adoc[]');
  expect(result.relations.filter(r => r.kind === 'xref').map(r => r.state)).toEqual(['missing', 'missing', 'blocked']);
  expect(result.relations.find(r => r.kind === 'include')).toMatchObject({ state: 'resolved', destination: { relativePath: 'shared/part.adoc', line: 1 } });
  expect(result.anchors).toContainEqual(expect.objectContaining({ id: '_shared_section', relativePath: 'shared/part.adoc' }));
  expect(result.targetAnchors).toContainEqual(expect.objectContaining({ id: '_shared_section' }));
});
test('reference navigation rejects junction escapes and preserves filtered include anchor locations', async () => {
  const root = await fixture(), outside = await fixture();
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(root, 'shared/part.adoc'), '// hidden\n\n[[part]]\n== Part\n\nText');
  const result = await analyze(root, 'main.adoc', 'include::shared/part.adoc[lines=3..6]\n\n<<part>> xref:link/shared/part.adoc[]');
  expect(result.relations.find(r => r.target === 'part')).toMatchObject({ state: 'resolved', destination: { relativePath: 'shared/part.adoc', line: 4 } });
  expect(result.relations.find(r => r.target === 'link/shared/part.adoc')).toMatchObject({ state: 'blocked' });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-03-')); roots.push(root);
  await fs.mkdir(path.join(root, 'docs')); await fs.mkdir(path.join(root, 'shared'));
  await fs.writeFile(path.join(root, 'shared/part.adoc'), '== Shared section\n\nshared content');
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-03-')) throw new Error('Invalid cleanup');
  await fs.rm(root, { recursive: true, force: true });
} });
test('one parser result provides rendered sections and source locations including sibling includes', async () => {
  const root = await fixture();
  const result = await analyze(root, 'docs/main.adoc', '= Title\n\n== Local\n\ntext\n\ninclude::../shared/part.adoc[]');
  expect(result.diagnostics).toEqual([]);
  expect(result.html).toContain('shared content');
  expect(result.diagnostics).toEqual([]);
  expect(result.outline).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Local', relativePath: 'docs/main.adoc', line: 3 }),
    expect.objectContaining({ title: 'Shared section', relativePath: 'shared/part.adoc', line: 1 })
  ]));
});
test.each(['../../secret.adoc', 'https://example.com/a.adoc', 'C:/secret.adoc', '/etc/passwd', '..\\secret.adoc'])('blocks external include %s', async target => {
  const root = await fixture();
  const result = await analyze(root, 'docs/main.adoc', `= Title\n\ninclude::${target}[]`);
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
test('blocks junction and cyclic includes; missing includes remain diagnostics', async () => {
  const root = await fixture(), outside = await fixture();
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(root, 'a.adoc'), 'include::b.adoc[]');
  await fs.writeFile(path.join(root, 'b.adoc'), 'include::a.adoc[]');
  const result = await analyze(root, 'main.adoc', 'include::link/shared/part.adoc[]\n\ninclude::a.adoc[]\n\ninclude::missing.adoc[]');
  expect(result.html).not.toContain('shared content');
  expect(result.diagnostics.length).toBe(3);
});
test('conditional includes, attributes, tags and line selection use approved source', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'shared/tagged.adoc'), '// tag::public[]\n== Public\n\nvisible\n// end::public[]\nprivate');
  const result = await analyze(root, 'docs/main.adoc', '= Title\n:part: ../shared/tagged.adoc\n:release:\n\nifdef::release[]\ninclude::{part}[tag=public]\nendif::[]\n\nifndef::release[]\ninclude::https://blocked.test/a[]\nendif::[]');
  expect(result.html).toContain('visible'); expect(result.html).not.toContain('private'); expect(result.diagnostics).toEqual([]);
  expect(result.outline[0]).toMatchObject({ line: 2, relativePath: 'shared/tagged.adoc' });
  const lines = await analyze(root, 'docs/main.adoc', 'include::../shared/tagged.adoc[lines=2..4]');
  expect(lines.html).toContain('visible'); expect(lines.html).not.toContain('private');
});
test('limits input and include count; unsupported options are explicit', async () => {
  const root = await fixture();
  await expect(analyze(root, 'main.adoc', 'a'.repeat(1024 * 1024 + 1))).rejects.toMatchObject({ code: 'TOO_LARGE' });
  const result = await analyze(root, 'main.adoc', 'include::shared/part.adoc[tags=!secret]\n\n' + 'include::shared/part.adoc[]\n\n'.repeat(65));
  expect(result.diagnostics.some(d => d.message.includes('한도'))).toBe(true);
  expect(result.diagnostics.some(d => d.message.includes('tag'))).toBe(true);
});
test('repeated selected includes retain separate original line mappings', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'shared/multi.adoc'), '== First\n\nfirst\n\n== Second\n\nsecond');
  const result = await analyze(root, 'main.adoc', '= Title\n\ninclude::shared/multi.adoc[lines=1..3]\n\ninclude::shared/multi.adoc[lines=5..7]');
  expect(result.outline.map(entry => [entry.title, entry.line])).toEqual([['First', 1], ['Second', 5]]);
});

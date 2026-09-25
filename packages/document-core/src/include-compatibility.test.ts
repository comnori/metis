import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { load, type AbstractBlock } from '@asciidoctor/core';
import { analyze } from './index';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-include-')) throw Error('Cleanup boundary');
    await fs.rm(root, { recursive: true, force: true });
  }
});
const scenarios = [
  { name: 'plain include', options: '', part: '== Part\n\n본문' },
  { name: 'positive leveloffset', options: 'leveloffset=+1', part: '== Part\n\n본문' },
  { name: 'line ranges', options: 'lines="2..3;5..-1"', part: 'hidden\n== Part\n\nremoved\n본문' },
  { name: 'single tag', options: 'tag=public', part: 'hidden\n// tag::public[]\n== Part\n\n본문\n// end::public[]\nhidden' },
  { name: 'multiple tags', options: 'tags="first;second"', part: '// tag::first[]\n== Part\n// end::first[]\n\n// tag::second[]\n\n본문\n// end::second[]' },
  { name: 'nested repeated tag', options: 'tag=public', part: '// tag::public[]\n== Part\n\n// tag::public[]\ninner\n// end::public[]\n\n== After nested\n\nTrailing content\n// end::public[]' },
  { name: 'nested different tags', options: 'tag=public', part: '// tag::public[]\n== Part\n\n// tag::inner[]\ninner\n// end::inner[]\n\nafter inner\n// end::public[]' },
  { name: 'repeated separate regions', options: 'tag=public', part: '// tag::public[]\n== Part\n// end::public[]\nhidden\n// tag::public[]\n\nvisible\n// end::public[]' },
  { name: 'negative leveloffset', options: 'leveloffset=-1', part: '=== Part\n\n본문' },
  { name: 'indent stripping', options: 'indent=0', part: '    alpha\n      beta', listing: true },
  { name: 'indent replacement', options: 'indent=2', part: '    alpha\n      beta', listing: true },
  { name: 'optional missing include', options: 'opts=optional', missing: true, part: '' },
];
for (const scenario of scenarios) test(`built-in include parity: ${scenario.name}`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-include-')); roots.push(root);
  if (!scenario.missing) await fs.writeFile(path.join(root, 'part.adoc'), scenario.part);
  const include = `include::part.adoc[${scenario.options}]`;
  const text = `= Main\n\n== Parent\n\n${scenario.listing ? `----\n${include}\n----` : include}`;
  // Only these trusted, generated local fixtures use the built-in filesystem loader.
  const reference = await load(text, { safe: 'safe', base_dir: root, standalone: false, sourcemap: true, attributes: { docfile: path.join(root, 'main.adoc'), docname: 'main', showtitle: '' } });
  const expected = String(await reference.convert());
  const actual = await analyze(root, 'main.adoc', text, false);
  expect(actual.html).toBe(expected);
  expect(actual.diagnostics).toEqual([]);
  const outline: Array<{ title: string; level: number; line: number; relativePath: string }> = [];
  function visit(node: AbstractBlock) {
    for (const section of node.getSections()) {
      const location = section.getSourceLocation();
      const filename = String(location?.getFile() ?? 'main.adoc');
      outline.push({ title: section.getTitle() ?? '', level: section.getLevel() ?? 1, line: location?.getLineNumber() ?? 1, relativePath: path.basename(filename) });
      visit(section);
    }
  }
  visit(reference);
  if (scenario.name === 'nested repeated tag') {
    // The built-in tag filter reports line 6 here, but the fixture heading is on line 8.
    expect(actual.outline.map(({ title, level }) => ({ title, level }))).toEqual(outline.map(({ title, level }) => ({ title, level })));
    expect(actual.outline).toContainEqual(expect.objectContaining({ title: 'After nested', relativePath: 'part.adoc', line: 8 }));
  } else expect(actual.outline.map(({ title, level, line, relativePath }) => ({ title, level, line, relativePath }))).toEqual(outline);
  if (!scenario.missing) expect(await fs.readFile(path.join(root, 'part.adoc'), 'utf8')).toBe(scenario.part);
  if (!scenario.missing) expect(actual.relations).toContainEqual(expect.objectContaining({ kind: 'include', state: 'resolved', destination: expect.objectContaining({ relativePath: 'part.adoc' }) }));
});

import { afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyze } from './index';
import { sourceCursor } from './source-cursor';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-article-')) throw Error('Cleanup boundary');
  await rm(root, { recursive: true, force: true });
} });
test('article header, abstract and formatted table cells keep preview and source metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metis-article-')); roots.push(root);
  const text = `// Article header regression
The Article Title
=================
Author <author@example.test>
v1.0, 2003-12
:toc: preamble
:product: Metis

Optional preamble.

:numbered!:
[abstract]
Example Abstract
----------------
Abstract body.

[[details]]
Details
-------

[cols="1,1"]
|===
|*Formatted cell* |{product}
|xref:details[Jump] |plain
|===
`;
  const file = path.join(root, 'article.adoc'); await writeFile(file, text);
  const result = await analyze(root, 'article.adoc', text);
  expect(result.html).toContain('The Article Title');
  expect(result.html).toContain('Abstract body.');
  expect(result.html).toContain('<strong>Formatted cell</strong>');
  expect(result.html).toContain('Metis');
  expect(result.relations).toContainEqual(expect.objectContaining({ target: 'details', state: 'resolved', relativePath: 'article.adoc', line: 24 }));
  expect(result.anchors).toContainEqual(expect.objectContaining({ id: 'details', relativePath: 'article.adoc' }));
  expect(await readFile(file, 'utf8')).toBe(text);
});
test('normalizes method cursors, plain cell cursors and absent locations', () => {
  expect(sourceCursor({ file: 'cell.adoc', lineno: 24 })).toEqual({ file: 'cell.adoc', line: 24 });
  expect(sourceCursor({ file: 'wrong', getFile() { return 'section.adoc'; }, getLineNumber() { return 7; } })).toEqual({ file: 'section.adoc', line: 7 });
  expect(sourceCursor(undefined)).toEqual({ file: undefined, line: 1 });
  expect(sourceCursor({ file: null, lineno: NaN })).toEqual({ file: undefined, line: 1 });
});

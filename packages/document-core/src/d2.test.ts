import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, test } from 'vitest';
import { analyze } from './index';

test('D2 blocks preserve options, source, title, anchor and included source locations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metis-d2-doc-'));
  await mkdir(path.join(root, 'parts'));
  await writeFile(path.join(root, 'parts/flow.adoc'), '[#flow]\n.Flow\n[d2,layout=elk,theme=300,sketch=true,target=layers.detail]\n----\na: "<script>"\na -> b\n----');
  const result = await analyze(root, 'main.adoc', '= D2\n\ninclude::parts/flow.adoc[]');
  expect(result.html).toContain('class="metis-d2"'); expect(result.html).toContain('id="flow"');
  expect(result.html).toContain('data-d2-path="parts/flow.adoc"'); expect(result.html).toContain('data-d2-line="5"');
  expect(result.html).toContain('&quot;layout&quot;:&quot;elk&quot;'); expect(result.html).toContain('&lt;script&gt;');
  expect(result.diagnostics).toEqual([]);
});

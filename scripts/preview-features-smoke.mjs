import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `preview-features-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, 'preview.adoc'), `= Preview features

[source,javascript]
----
const greeting = "hello";
----

.Flow
[mermaid]
----
flowchart LR
  A[AsciiDoc] --> B[Preview]
----

[mermaid]
----
flowchart LR
  A - broken
----
`);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡preview.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-mermaid-output svg').waitFor();
  assert.equal(await preview.locator('.hljs-keyword').count(), 1);
  assert.equal(await preview.locator('.metis-mermaid-output svg').count(), 1);
  assert.equal(await preview.locator('.metis-mermaid-error pre').count(), 1);
  const policy = await preview.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(policy?.includes("script-src 'none'"));
  assert.equal(await preview.locator('style[data-theme="asciidoctor"]').count(), 1);
  assert.equal(await preview.locator('style[data-theme="highlight"]').count(), 1);
  assert.equal(await preview.locator('style[data-theme="metis"]').count(), 1);
  console.log(JSON.stringify({ run, checks: ['offline syntax highlighting', 'sanitized Mermaid SVG and error fallback', 'Asciidoctor theme order', 'script-free preview CSP'] }, null, 2));
} finally { await app.close(); }

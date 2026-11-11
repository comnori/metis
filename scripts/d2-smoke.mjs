import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile, access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `d2-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(path.join(fixture, 'parts'), { recursive: true });
await writeFile(path.join(fixture, 'parts/shared.d2'), 'imported: Imported\nimported.shape: cylinder');
await writeFile(path.join(fixture, 'parts/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="red"/></svg>');
await writeFile(path.join(fixture, 'parts/flow.adoc'), `[d2,layout=elk,theme=300]
----
...@shared
app: Application {icon: icon.svg}
app -> imported
----`);
const block = (source, options = '') => `\n[d2${options ? ',' + options : ''}]\n----\n${source}\n----\n`;
const font = process.platform === 'win32' ? 'C:/Windows/Fonts/arial.ttf' : process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const hasFont = await access(font).then(() => true, () => false);
if (hasFont) await copyFile(font, path.join(fixture, 'custom.ttf'));
await writeFile(path.join(fixture, 'd2.adoc'), '= D2 coverage\n\ninclude::parts/flow.adoc[]\n'
  + block('direction: right\na: 시작\nb: 완료\na -> b: 요청 {style.animated: true}', 'layout=dagre,sketch=true')
  + block('a -> b\na.tooltip: Help\na.link: https://d2lang.com\na.icon: https://icons.d2lang.com/test.svg', 'layout=tala')
  + block('vars: {color: "#008080"}\nclasses: {service: {style.fill: ${color}}}\nx.class: service\ny.class: service\nx -> y')
  + block('db: {shape: sql_table; id: int {constraint: primary_key}; name: text}\nc: {shape: class; +field: string; +method(): void}\ndb -> c')
  + block('shape: sequence_diagram\nclient -> server: request\nserver -> client: response')
  + block('notes: |md\n  # Markdown\n  **bold** and `code`\n|\nformula: |latex\n  \\frac{x^2}{2}\n|\nsnippet: |js\n  const value = 42;\n|')
  + block('a -> b\nlayers: {detail: {c -> d}}\nscenarios: {alternative: {b -> c}}\nsteps: {first: {b -> c}; second: {c -> d}}')
  + block('a -> b\nsteps: {first: {b -> c}; second: {c -> d}}', 'animate-interval=500')
  + block('a -> b', 'ascii=true,ascii-mode=extended')
  + (hasFont ? block('a: Custom font\na -> b', 'font-regular=custom.ttf') : '')
  + block('a -> b\nlayers: {detail: {c -> d}}', 'target=layers.detail')
  + block('x: {')
  + '\n[mermaid]\n----\nflowchart LR\n A --> B\n----\n');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.argv[2] ?? executablePath, args: process.argv[2] ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') console.log('browser:', message.text().replace(/data:[^\s']+/g, '[data URL]').slice(0, 500)); });
  await page.route('https://icons.d2lang.com/test.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>' }));
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡d2.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-d2-output').first().waitFor();
  assert.equal(await preview.locator('.metis-d2-error').count(), 1, await preview.locator('.metis-d2-error').allTextContents());
  assert.equal(await preview.locator('.metis-d2-output').count(), 11 + Number(hasFont));
  assert.equal(await preview.locator('.metis-mermaid-output svg').count(), 1);
  assert.equal(await preview.locator('.metis-d2-output image').count() >= 2, true);
  assert.equal(await preview.locator('.metis-d2-output [data-web-url="https://d2lang.com"]').count(), 1);
  assert.equal(await preview.locator('.metis-d2-board').count() >= 14, true);
  assert.equal(await preview.locator('[data-d2-board="root"]>summary').count(), 0);
  assert.equal(await preview.getByRole('button', { name: /^(SVG|PNG|PDF) 저장$/ }).count(), 0);
  const css = await preview.locator('.metis-d2-output style').allTextContents(); assert.ok(css.some(s => s.includes('@keyframes')));
  await page.screenshot({ path: path.join(run, 'd2-preview.png'), fullPage: true });
  await preview.locator('.metis-d2-output').nth(6).evaluate(element => element.scrollIntoView());
  await page.screenshot({ path: path.join(run, 'd2-math-markdown.png') });
  for (const format of ['svg', 'png', 'pdf', 'gif', 'txt']) {
    const destination = path.join(run, `export.${format}`);
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, destination);
    const toolbar = preview.locator('.metis-d2-tools').filter({ has: preview.locator(`button[data-d2-export="${format}"]`) }).first();
    await toolbar.getByRole('button', { name: '다이어그램 다운로드', exact: true }).click();
    await toolbar.getByRole('menuitem', { name: format.toUpperCase(), exact: true }).click();
    assert.equal(await toolbar.getByRole('button', { name: '다이어그램 다운로드' }).getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => document.body.textContent.includes('D2 다이어그램을 저장했습니다.'));
    for (let i = 0; ; i++) { try { await access(destination); break; } catch { if (i >= 100) throw Error(`${format} export missing`); await new Promise(r => setTimeout(r, 100)); } }
    const bytes = await readFile(destination); assert.ok(bytes.length > 20);
    if (format === 'png') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    if (format === 'gif') assert.equal(bytes.subarray(0, 3).toString(), 'GIF');
  }
  await uiCommand(page, '확장 관리');
  const manager = page.getByRole('dialog', { name: '설정' });
  const d2 = manager.locator('article').filter({ has: page.getByRole('heading', { name: 'D2 다이어그램', exact: true }) });
  await d2.getByRole('button', { name: '비활성화', exact: true }).click();
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await preview.locator('.metis-d2 pre').first().waitFor();
  assert.equal(await preview.locator('.metis-d2-output').count(), 0);
  await page.reload(); await uiCommand(page, '확장 관리');
  await d2.getByRole('button', { name: '활성화', exact: true }).waitFor();
  await d2.getByRole('button', { name: '활성화', exact: true }).click();
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '≡d2.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await preview.locator('.metis-d2-output').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ run, checks: ['Dagre/ELK/TALA', 'sketch/theme/variables/classes', 'sequence/SQL/UML/Markdown/LaTeX/code', 'workspace imports/local and HTTPS icons', 'layers/scenarios/steps/animation/ASCII', 'SVG/PNG/PDF/GIF/TXT exports', 'error isolation and Mermaid coexistence', 'default activation, live toggle and restored preference'] }, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(run, 'failed.png') }); console.log((await page.locator('body').innerText()).slice(-6000)); console.log(await page.frameLocator('iframe[title="AsciiDoc 미리보기"]').locator('.metis-d2-error').allTextContents().catch(() => [])); }
  throw error;
} finally { await app.close(); }

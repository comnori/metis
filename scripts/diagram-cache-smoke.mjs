import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `diagram-cache-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, 'note.adoc'), '= Cache and position\n\n== Diagrams\n\n[mermaid]\n----\nflowchart LR\n A[Start] --> B[End]\n----\n\n[d2]\n----\na: Client\na -> b: request\nb: Server\n----\n\n== Paragraphs\n\n' + Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}. ${'Editing position should follow this paragraph. '.repeat(8)}\n`).join('\n') + '\nLast editing paragraph.\n');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '분할', exact: true }).click();
  const frame = page.locator('iframe[title="AsciiDoc 미리보기"]');
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-d2-diagram>svg').waitFor();
  const diagrams = () => frame.evaluate(frame => [...frame.contentDocument.querySelectorAll('.metis-mermaid-output>svg,.metis-d2-diagram>svg')].map(svg => svg.outerHTML));
  const original = await diagrams(); assert.equal(original.length, 2);
  await frame.evaluate(frame => { frame.dataset.unchanged = 'yes'; });
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.focus(); await page.keyboard.press('ControlOrMeta+End');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.scrollY > 2000);
  assert.equal(await frame.getAttribute('data-unchanged'), 'yes');
  await page.keyboard.insertText('Edited tail.');
  await preview.getByText('Last editing paragraph. Edited tail.', { exact: false }).waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe');
    const paragraph = [...(frame?.contentDocument?.querySelectorAll('.paragraph') ?? [])].find(p => p.textContent.includes('Edited tail.'));
    return paragraph && paragraph.getBoundingClientRect().top >= -2 && paragraph.getBoundingClientRect().top < frame.clientHeight;
  });
  assert.deepEqual(await diagrams(), original, 'prose edits must retain both rendered SVGs');
  await editor.focus(); await page.keyboard.press('ControlOrMeta+Home');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.scrollY < 3);
  await frame.evaluate(frame => { frame.dataset.unchanged = 'yes'; });
  await page.keyboard.insertText('// Leading comment\n');
  await page.waitForFunction(() => document.querySelector('iframe')?.dataset.unchanged !== 'yes' && document.querySelector('.preview-surface>p')?.textContent.startsWith('현재 편집 기준'));
  assert.deepEqual(await diagrams(), original, 'line shifts must retain both rendered SVGs');
  // Move only the caret to a paragraph in the middle of one large section.
  await editor.focus(); await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < 61; i++) await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.scrollY > 500);
  const before = await frame.evaluate(frame => frame.contentWindow.scrollY);
  await frame.evaluate(frame => { frame.dataset.unchanged = 'yes'; });
  await page.keyboard.insertText('Cursor edit ');
  await page.waitForFunction(() => document.querySelector('iframe')?.dataset.unchanged !== 'yes' && document.querySelector('.preview-surface>p')?.textContent.startsWith('현재 편집 기준'));
  assert.ok(await frame.evaluate(frame => frame.contentWindow.scrollY) > 500);
  assert.ok(Math.abs(await frame.evaluate(frame => frame.contentWindow.scrollY) - before) < 500);
  assert.deepEqual(await diagrams(), original);
  await editor.focus(); await page.keyboard.press('ControlOrMeta+Home');
  await editor.locator('.cm-line').filter({ hasText: 'A[Start]' }).click();
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await page.keyboard.insertText(' A[Updated] --> B[End]');
  await preview.locator('.metis-mermaid-output').getByText('Updated', { exact: true }).waitFor();
  const changed = await diagrams();
  assert.notEqual(changed[0], original[0]); assert.equal(changed[1], original[1]);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(run, 'position.png') });
  console.log(JSON.stringify({ run, checks: ['unchanged Mermaid/D2 SVGs across prose edits and line shifts', 'only the edited diagram changes', 'cursor-only movement without iframe recreation', 'automatic paragraph alignment after edits', 'document header alignment'] }, null, 2));
} catch (error) {
  console.error(error);
  if (page) console.error(await page.locator('iframe').evaluate(frame => ({ y: frame.contentWindow.scrollY, first: frame.contentDocument.body.innerHTML.slice(0, 500) })).catch(() => null));
  if (page) { console.error((await page.locator('body').innerText()).slice(-2500)); await page.screenshot({ path: path.join(run, 'failed.png') }); }
  throw error;
} finally { await app.close(); }

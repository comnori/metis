import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `m1-04-${Date.now()}`);
const fixture = path.join(run, 'workspace'); await mkdir(path.join(fixture, 'shared'), { recursive: true });
const source = '= Navigation\n:product: Metis\n\n[[local]]\n== Local\n\n{product} <<local>> <<missing>> xref:shared/part.adoc#part[]\n\ninclude::shared/part.adoc[]\n\nifdef::absent[]\nxref:ghost.adoc[]\nendif::[]';
await writeFile(path.join(fixture, 'note.adoc'), source);
await writeFile(path.join(fixture, 'shared/part.adoc'), '[[part]]\n== Part\n\nIncluded text');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
const checks = [];
try {
  const page = await app.firstWindow(); page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '오른쪽 사이드바', exact: true }).click();
  const relations = page.getByRole('region', { name: '관계 탐색' });
  await relations.getByText('참조 · missing · 대상 없음', { exact: true }).waitFor();
  assert.equal(await relations.getByText(/ghost/).count(), 0); checks.push('missing local reference and inactive exclusion');
  await relations.getByRole('button', { name: '대상 열기: shared/part.adoc#part', exact: true }).click();
  await page.getByRole('heading', { name: 'shared/part.adoc', exact: true }).waitFor(); checks.push('cross-document anchor navigation');
  await page.getByRole('tab', { name: 'note.adoc', exact: true }).click();
  await page.getByText('속성 · 조건', { exact: true }).click();
  await page.getByRole('button', { name: 'product: Metis', exact: true }).waitFor();
  await page.getByText(/현재 위치의 속성 조건 불충족/).waitFor(); checks.push('attribute declaration and condition context');
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  for (const [prefix, label, expected] of [['xref:lo', 'local', 'xref:local[]'], ['include::sha', 'shared/part.adoc', 'include::shared/part.adoc[]'], ['{prod', 'product', '{product}']]) {
    await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(source + '\n\n' + prefix);
    await page.keyboard.press('ControlOrMeta+Space');
    const option = page.getByRole('option').filter({ has: page.locator('.cm-completionLabel', { hasText: label }) }).first();
    await option.waitFor(); await option.click();
    await page.waitForFunction(expected => document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent?.endsWith(expected), expected);
    await page.keyboard.press('ControlOrMeta+z');
    assert.ok((await editor.textContent()).endsWith(prefix));
    checks.push(`standard completion and undo: ${prefix}`);
  }
  assert.equal(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), source); checks.push('navigation and completion do not save source');
  await page.getByRole('button', { name: '분할', exact: true }).click();
  await page.locator('.outline-item').filter({ hasText: 'Local' }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.screenshot({ path: path.join(run, 'window.png') });
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ platform: process.platform, packaged: !!packaged, checks }, null, 2));
  console.log(JSON.stringify({ run, checks }, null, 2));
} finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

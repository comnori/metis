import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m4-02-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true }); const original = '= Layout\n\n== Section\n\nBody'; await writeFile(path.join(fixture, 'a.adoc'), original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = []; let app, page;
async function launch() {
  app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await uiCommand(page, '폴더 열기'); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
}
try {
  await launch(); const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED');
  await page.getByLabel('도구 메뉴', { exact: true }).click(); await page.getByRole('button', { name: '문서 집합 검증', exact: true }).click();
  await page.getByRole('dialog', { name: '문서 집합 검증' }).getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.locator('.layout-menu').getAttribute('open'), null);
  await page.getByRole('button', { name: '파일', exact: true }).click(); assert.equal(await page.locator('.left-sidebar').isVisible(), false);
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await uiCommand(page, '보기 설정'); const width = page.getByRole('group', { name: '좌측 사이드바' }).getByRole('slider'); await width.focus(); await width.press('End');
  await page.keyboard.press('Escape'); assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 420);
  assert.ok((await editor.textContent()).includes('UNSAVED')); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('grouped commands, keyboard panel sizing and collapse preserve dirty document and disk');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
  await page.waitForFunction(() => document.querySelector('.left-sidebar').hasAttribute('inert'));
  const source = page.locator('.editor-panel:not([hidden]) .source'); assert.ok((await source.boundingBox()).height >= 240);
  await page.getByRole('button', { name: '파일', exact: true }).click(); await page.locator('.left-sidebar').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button', { name: '파일', exact: true }).evaluate(e => e === document.activeElement), true);
  await page.getByRole('button', { name: '오른쪽 사이드바', exact: true }).click(); await page.locator('.outline').waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1180, 800); w.webContents.setZoomFactor(2); });
  await page.waitForFunction(() => innerWidth === 590); assert.ok((await source.boundingBox()).height >= 120);
  await page.screenshot({ path: path.join(run, 'zoom.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.waitForFunction(() => document.querySelector('.left-sidebar').getBoundingClientRect().width === 420);
  checks.push('narrow and 200% layouts retain editor space; temporary panels restore focus without changing wide settings');
  await page.getByRole('button', { name: '오른쪽 사이드바', exact: true }).click();
  await page.getByRole('button', { name: '오른쪽 사이드바', exact: true }).click();
  await app.close(); app = undefined; await launch();
  assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 420); assert.equal(await page.locator('.outline').isVisible(), false);
  checks.push('workspace widths and collapsed state survive process restart');
  const other = path.join(run, 'other'); await mkdir(other); await app.evaluate(({ dialog }, other) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] }); }, other);
  await uiCommand(page, '폴더 열기'); await page.locator('.left-sidebar h2').filter({ hasText: /^other$/ }).waitFor(); assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 240);
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture); await uiCommand(page, '폴더 열기'); await page.locator('.left-sidebar h2').filter({ hasText: /^workspace$/ }).waitFor();
  assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 420);
  await uiCommand(page, '보기 설정'); await page.getByRole('button', { name: '보기 기본값 복원' }).click(); await page.keyboard.press('Escape');
  assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 240); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('distinct workspaces have independent preferences; reset restores defaults without writing source');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (e) { console.error('Completed:', checks); if (page) console.error(await page.locator('body').innerText().catch(() => '')); throw e; }
finally { if (app) await app.close(); }

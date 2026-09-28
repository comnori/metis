import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m2-05-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true }); const original = '= Sample\n\n== First\n\nBody'; await writeFile(path.join(fixture, 'a.adoc'), original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive()); page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await uiCommand(page, '확장 관리'); const manager = page.getByRole('dialog', { name: '확장 관리' });
  await manager.getByRole('status').filter({ hasText: '비활성' }).waitFor(); await manager.getByRole('button', { name: '활성화', exact: true }).click(); await manager.getByRole('status').filter({ hasText: /^활성$/ }).waitFor(); await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload(); await uiCommand(page, '확장 관리'); await manager.getByRole('button', { name: '비활성화', exact: true }).waitFor(); await manager.getByRole('button', { name: '닫기', exact: true }).click(); checks.push('bundled extension defaults disabled; enabling survives renderer restart');
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click(); await page.locator('.outline-item').filter({ hasText: 'First' }).waitFor();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n\n== Unsaved section'); await page.locator('.outline-item').filter({ hasText: 'Unsaved section' }).waitFor();
  const palette = page.getByRole('dialog', { name: '명령 팔레트' });
  await page.keyboard.press('ControlOrMeta+Shift+P'); await palette.getByRole('combobox').fill('확장: 문서 개요'); await palette.getByRole('combobox').press('Enter');
  const view = page.getByRole('dialog', { name: '확장 보기' }); await view.getByRole('listitem').filter({ hasText: 'Unsaved section' }).waitFor(); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original); checks.push('extension command renders current unsaved document model without saving source');
  await view.getByRole('button', { name: '확장 비활성화', exact: true }).click(); await view.waitFor({ state: 'hidden' }); assert.ok((await editor.textContent()).includes('Unsaved section'));
  await page.keyboard.press('ControlOrMeta+Shift+P'); await palette.getByRole('combobox').fill('확장: 문서 개요'); await palette.getByRole('status').filter({ hasText: '일치하는 명령이 없습니다' }).waitFor(); await palette.getByRole('combobox').press('Escape'); checks.push('disable closes extension view and unregisters command while retaining dirty buffer');
  await uiCommand(page, '확장 관리'); await manager.getByRole('button', { name: '제거', exact: true }).click(); await manager.getByRole('status').filter({ hasText: '제거됨' }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('metis.extensions.v1'))['document-summary']), 'removed'); await manager.getByRole('button', { name: '다시 추가', exact: true }).click(); await manager.getByRole('status').filter({ hasText: '비활성' }).waitFor(); await manager.getByRole('button', { name: '활성화', exact: true }).click(); await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+Shift+P'); await palette.getByRole('combobox').fill('확장: 문서 개요'); await palette.getByRole('combobox').press('Enter'); await view.getByRole('listitem').filter({ hasText: 'Unsaved section' }).waitFor(); checks.push('remove and reinstall restore contributions without modifying the document');
  await page.screenshot({ path: path.join(run, 'extension-view.png') }); await view.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click(); await page.locator('footer').filter({ hasText: '저장했습니다.' }).waitFor(); assert.ok((await readFile(path.join(fixture, 'a.adoc'), 'utf8')).includes('Unsaved section')); checks.push('normal document save remains available after extension lifecycle changes');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); throw error; }
finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `ux-redesign-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= UX redesign\n\n== First section\n\nA saved sentence.\n\n== Second section\n\nAnother paragraph.';
await writeFile(path.join(fixture, 'a.adoc'), original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const checks = [], errors = [];
async function closeSettings() { await page.getByRole('dialog', { name: '설정', exact: true }).getByRole('button', { name: '닫기', exact: true }).click(); }
async function visibleActions(dialog) {
  return dialog.evaluate(node => {
    const box = node.getBoundingClientRect();
    return [...node.querySelectorAll('.dialog-header button,.dialog-footer button')].every(button => { const r = button.getBoundingClientRect(); return r.width > 0 && r.top >= box.top && r.bottom <= box.bottom + 1 && r.left >= box.left && r.right <= box.right + 1 && r.bottom <= innerHeight && r.right <= innerWidth; });
  });
}
try {
  const packaged = process.argv[2]; app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { const win = BrowserWindow.getAllWindows()[0]; win.showInactive(); win.setContentSize(1366, 768); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED UX');
  assert.equal(await page.locator('.ribbon').count(), 0);
  assert.equal(await page.locator('.left-sidebar .sidebar-tabs').count(), 0);
  assert.equal(await page.getByRole('navigation', { name: '문서 탐색' }).getByRole('button').count(), 3);
  await page.screenshot({ path: path.join(run, 'workspace.png') });
  checks.push('Named sidebar replaces duplicate rail and tabs');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  assert.equal(await settings.getByRole('group', { name: '글꼴과 크기' }).count(), 0);
  await page.mouse.click(1, 1); assert.equal(await settings.isVisible(), true);
  const width = await settings.evaluate(e => e.getBoundingClientRect().width / innerWidth); assert.ok(width > .79 && width < .81);
  await settings.getByRole('searchbox').fill('글꼴');
  await settings.getByRole('button', { name: '글꼴과 크기', exact: false }).click();
  const uiSize = settings.getByLabel(/UI 크기/); await uiSize.fill('18');
  await settings.getByRole('button', { name: '직전 변경 되돌리기' }).click(); assert.equal(await uiSize.inputValue(), '16');
  await uiSize.fill('19');
  await settings.getByRole('button', { name: '미리보기', exact: true }).click();
  await settings.getByRole('combobox', { name: '내장 테마' }).selectOption('dark');
  await settings.getByRole('button', { name: '이 범주 기본값 복원' }).click();
  await settings.getByRole('button', { name: '글꼴과 편집기', exact: true }).click(); assert.equal(await uiSize.inputValue(), '19');
  await settings.getByRole('button', { name: '이 범주 기본값 복원' }).click();
  await settings.getByRole('button', { name: '확장', exact: true }).click(); assert.equal(await page.locator('dialog[open]').count(), 1);
  await settings.getByRole('button', { name: '화면과 배치', exact: true }).click();
  await page.screenshot({ path: path.join(run, 'settings.png') });
  assert.equal(await visibleActions(settings), true);
  await closeSettings(); checks.push('Categorized settings search, immediate apply, undo and scoped reset');
  await uiCommand(page, 'Git 이력'); await page.getByRole('tabpanel', { name: 'Git 변경·이력', exact: true }).waitFor();
  await page.getByRole('tab', { name: /a.adoc/ }).first().click(); assert.ok((await editor.innerText()).includes('UNSAVED UX'));
  await uiCommand(page, '문서 맥락 검토');
  const context = page.getByRole('tabpanel', { name: '문서 맥락', exact: true });
  await context.getByRole('button', { name: '맥락 구성', exact: true }).click(); await context.getByRole('region', { name: '검토 결과' }).waitFor();
  await page.getByRole('tab', { name: 'Git 변경·이력', exact: true }).click();
  await page.getByRole('tab', { name: '문서 맥락', exact: true }).click(); await context.getByRole('region', { name: '검토 결과' }).waitFor();
  await context.getByRole('button', { name: /출처: a.adoc:/, exact: false }).first().click();
  assert.ok((await editor.innerText()).includes('UNSAVED UX')); assert.equal(await page.getByRole('tab', { name: '문서 맥락', exact: true }).count(), 1);
  await uiCommand(page, '문서 맥락 검토'); assert.equal(await page.getByRole('tab', { name: '문서 맥락', exact: true }).count(), 1);
  checks.push('Review tabs retain input/results and source navigation preserves unsaved documents');
  await page.getByRole('button', { name: '도움말', exact: true }).click(); assert.equal(await page.locator('dialog[open]').count(), 0);
  const help = page.getByRole('tabpanel', { name: '도움말', exact: true });
  await help.getByRole('searchbox').fill('첨부'); await help.getByRole('button', { name: '첨부파일', exact: true }).click(); await help.getByRole('button', { name: '첨부파일 삽입', exact: true }).waitFor();
  checks.push('Searchable contextual help stays in a task tab');
  for (const [w, h, zoom] of [[1920, 1080, 1], [1366, 768, 1], [800, 600, 1], [1366, 768, 2]]) {
    await app.evaluate(({ BrowserWindow }, { w, h, zoom }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w,h); win.webContents.setZoomFactor(zoom); }, { w,h,zoom });
    await page.waitForTimeout(100);
    // At narrow sizes the sidebar is intentionally collapsed; use its named toggle.
    if (!(await page.getByRole('button', { name: '설정', exact: true }).isVisible()) || await page.evaluate(() => innerWidth <= 900)) await page.getByRole('button', { name: '탐색', exact: true }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click(); await settings.waitFor();
    await settings.locator('.settings-content').evaluate(e => e.scrollTop = e.scrollHeight);
    assert.equal(await visibleActions(settings), true, `fixed settings actions ${w}x${h}@${zoom}`);
    assert.equal(await settings.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
    const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')); await writeFile(path.join(run, `settings-${w}-${h}-${zoom}.png`), Buffer.from(capture, 'base64'));
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' });
    if (await page.evaluate(() => innerWidth <= 900)) await page.keyboard.press('Escape');
  }
  checks.push('1920, 1366, 800 and 200% layouts keep fixed dialog controls visible');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setZoomFactor(1); win.setContentSize(1366, 768); });
  const migration = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('metis.layout.v3.') && !key.endsWith('.window'));
    const legacyKey = key.replace('.v3.', '.v2.'), legacy = JSON.stringify({ version: 2, left: { open: false, active: 'favorites', width: 350 }, right: { open: false, active: 'diagnostics', width: 310 } });
    localStorage.setItem(legacyKey, legacy); localStorage.removeItem(key); return { key, legacyKey, legacy };
  });
  await page.reload(); await page.waitForFunction(({ key }) => !!localStorage.getItem(key), migration);
  const migrated = await page.evaluate(({ key, legacyKey }) => ({ current: JSON.parse(localStorage.getItem(key)), old: localStorage.getItem(legacyKey) }), migration);
  assert.deepEqual(migrated.current, { ...JSON.parse(migration.legacy), version: 3 }); assert.equal(migrated.old, migration.legacy);
  await page.getByRole('button', { name: '탐색', exact: true }).click(); await page.locator('.favorites-panel').waitFor(); assert.equal(Math.round((await page.locator('.left-sidebar').boundingBox()).width), 350);
  checks.push('Layout v2 migrates panel selection, visibility and widths to v3 while retaining the original key');
  assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original); assert.deepEqual(errors, []);
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { if (page) await page.screenshot({ path: path.join(run, 'failed.png') }).catch(() => {}); console.error('Artifacts:', run, 'Renderer errors:', errors, error); throw error; }
finally { await app?.close(); }

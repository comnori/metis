import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-01-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const files = {
  'a.adoc': '= A\n:edition: public\n:public:\n\ninclude::shared.adoc[tag=body]\n\ninclude::private.adoc[]',
  'b.adoc': '= B\n:edition: internal\n\ninclude::shared.adoc[tag=body]',
  'shared.adoc': '// tag::body[]\n== Shared\n\n{edition}\n\nifdef::public[]\nPublic body\nendif::[]\n// end::body[]',
  'private.adoc': 'PRIVATE SECRET'
};
for (const [name, text] of Object.entries(files)) await writeFile(path.join(fixture, name), text);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n\n== UNSAVED ONLY');
  await page.keyboard.press('ControlOrMeta+Shift+P'); const palette = page.getByRole('dialog', { name: '명령 팔레트' }); await palette.getByRole('combobox').fill('문서 맥락 검토'); await palette.getByRole('combobox').press('Enter');
  const modal = page.getByRole('dialog', { name: '문서 맥락 검토' });
  await modal.getByRole('checkbox', { name: 'b.adoc', exact: true }).check(); await modal.getByRole('checkbox', { name: 'shared.adoc', exact: true }).check();
  await modal.getByRole('checkbox', { name: '해석 기준: b.adoc', exact: true }).check();
  async function build() { await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '맥락 구성을 완료했습니다.' }).waitFor(); }
  await build();
  const result = modal.getByRole('region', { name: '검토 결과', exact: true });
  assert.ok((await result.textContent()).includes('외부 전송 없음')); assert.ok(!(await result.textContent()).includes('UNSAVED ONLY')); assert.ok(!(await result.textContent()).includes('PRIVATE SECRET'));
  assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), files['a.adoc']);
  checks.push('palette opens local-only context; selected saved sources exclude dirty buffer and private include');
  const a = modal.getByRole('region', { name: '해석 맥락: a.adoc', exact: true }), b = modal.getByRole('region', { name: '해석 맥락: b.adoc', exact: true });
  await a.locator('summary').filter({ hasText: '속성·조건·참조·진단' }).click(); await b.locator('summary').filter({ hasText: '속성·조건·참조·진단' }).click();
  assert.match(await a.textContent(), /사용 edition: public/); assert.match(await b.textContent(), /사용 edition: internal/);
  assert.ok((await a.textContent()).includes('선택 범위 밖의 포함')); assert.match(await a.textContent(), /public.*활성/); assert.match(await b.textContent(), /public.*비활성/);
  await page.screenshot({ path: path.join(run, 'context-review.png') });
  await modal.evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(run, 'context-scope.png') });
  checks.push('one shared source retains separate parent attributes and conditional contexts with excluded-include warning');
  await modal.getByRole('button', { name: '범위에서 제외: shared.adoc', exact: true }).click(); await result.waitFor({ state: 'hidden' });
  await modal.getByRole('checkbox', { name: 'shared.adoc', exact: true }).check(); await build();
  checks.push('scope change invalidates previous bundle and explicit rebuild restores it');
  await result.getByRole('button', { name: '출처: shared.adoc:2', exact: true }).first().click(); await modal.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'shared.adoc', exact: true }).waitFor();
  await page.getByRole('tab', { name: '● a.adoc', exact: true }).click(); assert.ok((await editor.textContent()).includes('UNSAVED ONLY'));
  checks.push('context evidence opens original include line and retains unsaved parent tab');
  await uiCommand(page, '문서 맥락 검토'); await build();
  await unlink(path.join(fixture, 'a.adoc'));
  await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await result.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => { const s = document.querySelector('dialog[aria-label="문서 맥락 검토"] [role=status]'); return s && !s.textContent.includes('구성하고 있습니다') && !s.textContent.includes('완료했습니다'); });
  await modal.getByRole('button', { name: '닫기', exact: true }).click(); assert.ok((await editor.textContent()).includes('UNSAVED ONLY'));
  await writeFile(path.join(fixture, 'a.adoc'), files['a.adoc']);
  checks.push('missing selected source clears old context, reports failure and preserves editor');
  const boundary = await page.evaluate(async () => {
    const opened = await window.metis.openWorkspace({ requestId: 'test-open' }); if (!opened.ok) throw Error('open failed');
    const scope = { workspaceId: opened.value.workspaceId, workspaceEpoch: opened.value.workspaceEpoch };
    const invalid = await window.metis.buildContext({ ...scope, requestId: 'invalid', paths: ['../secret.adoc'], roots: ['../secret.adoc'] });
    const pending = window.metis.buildContext({ ...scope, requestId: 'cancelled', paths: ['a.adoc'], roots: ['a.adoc'] });
    await window.metis.cancelContext({ ...scope, requestId: 'cancel' });
    const cancelled = await pending;
    const preview = await window.metis.analyzeDocument({ ...scope, requestId: 'preview', relativePath: 'a.adoc', text: '= Preview\n\n== Alive' });
    const rebuilt = await window.metis.buildContext({ ...scope, requestId: 'again', paths: ['a.adoc'], roots: ['a.adoc'] });
    const stale = await window.metis.buildContext({ ...scope, workspaceEpoch: scope.workspaceEpoch + 1, requestId: 'stale', paths: ['a.adoc'], roots: ['a.adoc'] });
    return { invalid, cancelled, preview: preview.ok, rebuilt: rebuilt.ok, stale };
  });
  assert.equal(boundary.invalid.error.code, 'INVALID_REQUEST'); assert.equal(boundary.cancelled.error.code, 'CANCELLED'); assert.equal(boundary.preview, true); assert.equal(boundary.rebuilt, true); assert.equal(boundary.stale.error.code, 'STALE_WORKSPACE');
  checks.push('host rejects traversal and stale session; context cancellation leaves preview and next context usable');
  for (const [name, text] of Object.entries(files)) assert.equal(await readFile(path.join(fixture, name), 'utf8'), text);
  checks.push('review, navigation and cancellation never alter source files');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); } throw error; }
finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

import { uiCommand } from './ui-command.mjs';
import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-04-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= A\n:port: 80\n\n== Cache\n\nCache saves data.\n\nxref:b.adoc[]\n\ninclude::private.adoc[]\n\nifdef::absent[]\nINACTIVE SECRET\nendif::[]';
await writeFile(path.join(fixture, 'a.adoc'), original);
await writeFile(path.join(fixture, 'b.adoc'), '= B\n:port: 443\n\nCache expires.');
await writeFile(path.join(fixture, 'private.adoc'), 'PRIVATE SECRET');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED BUFFER');
  await page.keyboard.press('ControlOrMeta+Shift+P'); const palette = page.getByRole('dialog', { name: '명령 팔레트' }); await palette.getByRole('combobox').fill('문서 근거 탐색'); await palette.getByRole('combobox').press('Enter');
  const modal = page.getByRole('dialog', { name: '문서 근거 탐색' }), search = modal.getByRole('region', { name: '문서 근거 검색', exact: true }), results = modal.getByRole('region', { name: '근거 검색 결과', exact: true });
  async function build() { await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '맥락 구성을 완료했습니다.' }).waitFor(); }
  async function query(text) { await search.getByLabel('찾을 내용').fill(text); await search.getByRole('button', { name: '근거 찾기', exact: true }).click(); }
  await modal.getByRole('checkbox', { name: 'b.adoc', exact: true }).check(); await modal.getByRole('checkbox', { name: '해석 기준: b.adoc', exact: true }).check(); await build();
  assert.ok(!(await modal.textContent()).includes('PRIVATE SECRET')); assert.ok(!(await modal.textContent()).includes('UNSAVED BUFFER'));
  await query('Cache'); assert.ok((await results.textContent()).includes('Cache saves data.')); assert.ok((await results.textContent()).includes('Cache expires.'));
  checks.push('palette opens selected saved-source retrieval with ranked extracts and explicit AI limitations');
  await query('SECRET'); assert.ok((await results.textContent()).includes('근거 부족')); assert.equal(await results.locator('article').count(), 0);
  await query('port'); assert.ok((await results.textContent()).includes('상충 후보: port 값 차이'));
  await results.getByText('상충 후보: port 값 차이', { exact: true }).click();
  assert.ok((await results.textContent()).includes('port: 443'));
  await results.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run, 'evidence.png') });
  checks.push('inactive and unselected content cannot supply evidence; differing attributes retain parent context');
  await query('b.adoc'); assert.ok((await results.textContent()).includes('명시적 관계 선언')); assert.ok((await results.textContent()).includes('unchecked'));
  await query('Cache'); await search.getByLabel('찾을 내용').fill('updated'); await results.waitFor({ state: 'hidden' });
  await query('Cache'); await modal.getByRole('button', { name: '범위에서 제외: b.adoc', exact: true }).click(); await search.waitFor({ state: 'hidden' }); await build(); await query('Cache'); assert.ok(!(await results.textContent()).includes('Cache expires.'));
  checks.push('query and scope changes clear stale results; explicit reference state remains distinct from recommendations');
  await results.getByRole('button', { name: '출처: a.adoc:6', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.ok((await editor.textContent()).includes('UNSAVED BUFFER')); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('evidence navigation preserves unsaved editing and source bytes');
  await uiCommand(page, '문서 근거 탐색'); await build(); await query('Cache');
  await writeFile(path.join(fixture, 'a.adoc'), '= A\n\nChanged replacement'); await build(); await query('Cache'); assert.equal(await results.locator('article').count(), 0);
  await query('Changed'); assert.ok((await results.textContent()).includes('Changed replacement'));
  checks.push('explicit refresh replaces old evidence and revisions after disk edits');
  await unlink(path.join(fixture, 'a.adoc')); await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await search.waitFor({ state: 'hidden' });
  await modal.getByRole('status').filter({ hasText: '파일 또는 폴더를 찾을 수 없습니다' }).waitFor();
  await modal.getByRole('button', { name: '닫기', exact: true }).click(); assert.ok((await editor.textContent()).includes('UNSAVED BUFFER'));
  checks.push('failed refresh removes stale evidence and leaves editing available');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); } throw error; }
finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

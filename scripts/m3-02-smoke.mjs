import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-02-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= A\n\nxref:b.adoc#missing[]\n\n{undefined}\n\ninclude::private.adoc[]\n\n==== Jump';
const bOriginal = '= B\n\n[[good]]\n== Good';
await writeFile(path.join(fixture, 'a.adoc'), original); await writeFile(path.join(fixture, 'b.adoc'), bOriginal); await writeFile(path.join(fixture, 'private.adoc'), 'PRIVATE SECRET');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED BUFFER');
  await page.keyboard.press('ControlOrMeta+Shift+P'); const palette = page.getByRole('dialog', { name: '명령 팔레트' }); await palette.getByRole('combobox').fill('문서 집합 검증'); await palette.getByRole('combobox').press('Enter');
  const modal = page.getByRole('dialog', { name: '문서 집합 검증' }), result = modal.getByRole('region', { name: '문서 검증 결과', exact: true });
  async function selectB() { await modal.getByRole('checkbox', { name: 'b.adoc', exact: true }).check(); await modal.getByRole('checkbox', { name: '해석 기준: b.adoc', exact: true }).check(); }
  async function validate() { await modal.getByRole('button', { name: '문서 검증', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '문서 검증을 완료했습니다.' }).waitFor(); }
  await selectB(); await validate();
  assert.ok((await result.textContent()).includes('앵커를 찾지 못했습니다: #missing'));
  assert.ok((await result.textContent()).includes('속성 {undefined}'));
  assert.ok((await result.textContent()).includes('해석기 진단'));
  assert.ok((await result.textContent()).includes('포함 내용을 검증하지 못했습니다'));
  assert.ok((await result.textContent()).includes('AI 추론 의견은 생성하지 않았습니다.'));
  assert.ok(!(await modal.textContent()).includes('PRIVATE SECRET')); assert.ok(!(await modal.textContent()).includes('UNSAVED BUFFER'));
  checks.push('palette validation separates confirmed rules, parser diagnostics and unchecked includes using selected saved sources only');
  await result.getByLabel('검증 분류').selectOption('reference'); await result.getByLabel('검증 판정').selectOption('confirmed');
  assert.equal(await result.locator('article').count(), 1);
  await result.getByLabel('검증 해석 기준').selectOption('b.adoc'); await result.getByText('선택한 필터에 해당하는 항목이 없습니다.', { exact: true }).waitFor();
  await result.getByLabel('검증 해석 기준').selectOption('a.adoc'); assert.equal(await result.locator('article').count(), 1);
  await result.getByRole('heading', { name: '검증 결과', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run, 'validation.png') });
  checks.push('category, certainty and parent-context filters preserve distinct no-match feedback');
  await result.getByRole('button', { name: '출처: a.adoc:3', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.ok((await editor.textContent()).includes('UNSAVED BUFFER')); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('problem location navigation preserves unsaved tab and disk source');
  await uiCommand(page, '문서 집합 검증'); await selectB(); await validate();
  await modal.getByRole('button', { name: '범위에서 제외: b.adoc', exact: true }).click(); await result.waitFor({ state: 'hidden' }); await validate();
  await result.getByLabel('검증 분류').selectOption('reference'); assert.match(await result.textContent(), /선택 범위 밖이라 대상 존재 여부를 확인하지 않았습니다: b.adoc/); assert.equal(await result.locator('article').filter({ hasText: '규칙으로 확인' }).count(), 0);
  checks.push('removing a target invalidates the old report and changes absence claims to unchecked scope');
  const repaired = '= B\n\n[[missing]]\n== Repaired'; await writeFile(path.join(fixture, 'b.adoc'), repaired);
  await selectB(); await validate(); await result.getByLabel('검증 분류').selectOption('reference');
  await result.getByText('선택한 필터에 해당하는 항목이 없습니다.', { exact: true }).waitFor();
  assert.equal(await result.locator('article').count(), 0);
  checks.push('explicit revalidation consumes the new target revision and removes obsolete missing-anchor issue');
  await unlink(path.join(fixture, 'b.adoc')); await modal.getByRole('button', { name: '문서 검증', exact: true }).click(); await result.waitFor({ state: 'hidden' });
  await modal.getByRole('status').filter({ hasText: '파일 또는 폴더를 찾을 수 없습니다' }).waitFor();
  await modal.getByRole('button', { name: '닫기', exact: true }).click(); assert.ok((await editor.textContent()).includes('UNSAVED BUFFER'));
  assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original); assert.equal(await readFile(path.join(fixture, 'private.adoc'), 'utf8'), 'PRIVATE SECRET');
  checks.push('deleted selected source clears stale results, reports failure and keeps original editing available');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); } throw error; }
finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

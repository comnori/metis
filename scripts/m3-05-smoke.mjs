import { uiCommand } from './ui-command.mjs';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const agent = process.env.METIS_TEST_AGENT === '1';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `${agent ? 'm3-06' : 'm3-05'}-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= Guide\n\nAlpha text\n\nBeta text\n'; await writeFile(path.join(fixture, 'a.adoc'), original);
const proposal = JSON.stringify({ version: 1, changes: [{ id: 'alpha', before: 'Alpha text', after: 'Alpha revised', reason: 'Alpha 개선', evidence: [{ quote: 'Beta text' }] }, { id: 'beta', before: 'Beta text', after: 'Beta revised {proposal-undefined}', reason: 'Beta 개선' }] });
let mode = 'normal', pending, requests = 0;
const server = createServer(async (req, res) => {
  try {
    let input = ''; for await (const chunk of req) input += chunk;
    requests++; const body = JSON.parse(input);
    assert.equal(req.url, agent ? '/metis/v1/proposals' : '/v1/chat/completions');
    assert.ok((agent ? body.document.text : JSON.parse(body.messages[1].content).document).includes('UNSAVED'));
    if (agent) { assert.equal(body.document.relativePath, 'a.adoc'); assert.equal(body.validation.checkedDocuments, 1); res.setHeader('Content-Type', 'application/x-ndjson'); res.write(JSON.stringify({ type: 'progress', message: '근거 검토 중' }) + '\n'); }
    const respond = () => { if (!res.destroyed) { if (agent) { res.end(JSON.stringify({ type: 'proposal', proposal: JSON.parse(mode === 'invalid' ? proposal.replace('Alpha text', 'absent') : proposal) }) + '\n'); return; } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: mode === 'invalid' ? proposal.replace('Alpha text', 'absent') : proposal } }] })); } };
    if (mode === 'hold') pending = respond; else if (agent && mode === 'normal') setTimeout(respond, 1500); else respond();
  } catch (error) { res.statusCode = 500; res.end(); console.error(error); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env, timeout: 30000 }); let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED');
  await page.keyboard.press('ControlOrMeta+Shift+P'); const palette = page.getByRole('dialog', { name: '명령 팔레트' }); await palette.getByRole('combobox').fill('변경 제안 검토'); await palette.getByRole('combobox').press('Enter');
  const modal = page.getByRole('dialog', { name: '변경 제안 검토' });
  const consent = modal.getByRole('checkbox', { name: '선택한 변경과 비교 한계를 확인했고 초안 반영을 승인합니다.' });
  const apply = modal.getByRole('button', { name: '승인한 변경을 초안에 반영' });
  async function load() { await modal.getByLabel('제안 JSON').fill(proposal); await modal.getByRole('button', { name: '제안 읽기', exact: true }).click(); }
  async function compare() { await modal.getByRole('button', { name: '선택 변경 비교', exact: true }).click(); await modal.getByRole('region', { name: '제안 비교 결과' }).waitFor(); await modal.getByRole('region', { name: '제안 문서 검증' }).waitFor(); }
  const sendConsent = modal.getByRole('checkbox', { name: '서버·모델·변경 요청·전체 원문을 확인했고 이번 전송을 승인합니다.' });
  const generate = modal.getByRole('button', { name: 'AI 제안 생성', exact: true });
  if (agent) await modal.getByLabel('제안 API').selectOption('external-agent');
  await modal.getByLabel('제안 서버 포트').fill(String(port)); if (!agent) await modal.getByLabel('제안 모델', { exact: true }).fill('fixture-model'); await modal.getByLabel('변경 요청', { exact: true }).fill('문장 개선');
  assert.equal(await generate.isDisabled(), true); assert.equal(requests, 0);
  await sendConsent.check(); await modal.getByLabel('변경 요청', { exact: true }).fill('원문에 근거해 문장 개선'); assert.equal(await sendConsent.isChecked(), false);
  mode = 'hold'; await sendConsent.check(); await generate.click(); await modal.getByRole('button', { name: '제안 생성 취소' }).click(); await modal.getByRole('status').filter({ hasText: '취소' }).waitFor(); pending?.();
  assert.equal(await apply.isDisabled(), true);
  mode = 'invalid'; await sendConsent.check(); await generate.click(); await modal.getByRole('status').filter({ hasText: '이전 원문이 정확히 한 곳' }).waitFor(); assert.equal(await modal.getByRole('checkbox', { name: '변경 alpha', exact: true }).count(), 0);
  pending = undefined; mode = 'hold'; await sendConsent.check(); await generate.click();
  for (let i = 0; !pending && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(pending); await writeFile(path.join(fixture, 'a.adoc'), '= Changed during generation\n'); pending();
  await modal.getByRole('status').filter({ hasText: '생성 중 저장본이 변경' }).waitFor(); assert.equal(await apply.isDisabled(), true);
  await writeFile(path.join(fixture, 'a.adoc'), original);
  checks.push('disk revision changes during generation discard the returned proposal');
  mode = 'normal'; await sendConsent.check(); await generate.click(); if (agent) { await modal.getByRole('status').filter({ hasText: 'Agent 보고: 근거 검토 중' }).waitFor(); await modal.getByRole('status').filter({ hasText: 'Agent 보고:' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run, 'agent-progress.png') }); checks.push('Agent receives only approved snapshot and validation; streamed progress appears before final proposal'); } await modal.getByRole('checkbox', { name: '변경 alpha', exact: true }).waitFor(); assert.equal(await sendConsent.isChecked(), false); assert.equal(await apply.isDisabled(), true);
  assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('generation requires renewed transfer consent; cancellation and invalid source rejected; generated proposals remain unselected and disk unchanged');
  assert.equal(await modal.getByRole('checkbox', { name: '변경 alpha', exact: true }).isChecked(), false); assert.equal(await apply.isDisabled(), true);
  await modal.locator('summary').filter({ hasText: '근거 인용 (1)' }).click(); await modal.getByText('a.adoc:5 · 기준 원문', { exact: true }).waitFor();
  await modal.getByRole('button', { name: '전체 거부하고 닫기' }).click(); await modal.waitFor({ state: 'hidden' });
  assert.ok((await editor.textContent()).includes('UNSAVED')); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('palette review defaults to no selected edits; rejection preserves disk and dirty buffer');
  await uiCommand(page, '변경 제안 검토'); await load();
  await modal.getByRole('checkbox', { name: '변경 alpha', exact: true }).check(); await compare(); await consent.check();
  await modal.getByRole('checkbox', { name: '변경 beta', exact: true }).check(); assert.equal(await consent.isChecked(), false); assert.equal(await apply.isDisabled(), true);
  await compare(); await modal.getByRole('region', { name: '제안 문서 검증' }).getByText(/속성.*proposal-undefined/).waitFor();
  await modal.getByRole('checkbox', { name: '변경 beta', exact: true }).uncheck(); await compare(); await consent.check();
  assert.equal(await modal.getByRole('region', { name: '제안 문서 검증' }).getByText(/속성.*proposal-undefined/).count(), 0);
  checks.push('evidence quotes show verified source lines; selected-result validation updates after deselection');
  await modal.getByRole('region', { name: '제안 문서 검증' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run, 'proposal.png') });
  await apply.click(); await modal.waitFor({ state: 'hidden' });
  assert.ok((await editor.textContent()).includes('Alpha revised')); assert.ok((await editor.textContent()).includes('Beta text')); assert.ok((await editor.textContent()).includes('UNSAVED')); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('selection changes invalidate comparison and approval; approved subset reaches draft only');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('tab', { name: 'a.adoc', exact: true }).waitFor(); const saved = await readFile(path.join(fixture, 'a.adoc'), 'utf8'); assert.ok(saved.includes('Alpha revised')); assert.ok(saved.includes('Beta text'));
  checks.push('draft uses existing explicit save path and preserves unselected changes');
  await uiCommand(page, '변경 제안 검토');
  await modal.getByLabel('제안 JSON').fill(proposal); await modal.getByRole('button', { name: '제안 읽기', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '이전 원문이 정확히 한 곳' }).waitFor(); assert.equal(await apply.isDisabled(), true);
  const next = JSON.stringify({ version: 1, changes: [{ id: 'beta', before: 'Beta text', after: 'Beta revised', reason: '수정' }] });
  await modal.getByLabel('제안 JSON').fill(next); await modal.getByRole('button', { name: '제안 읽기', exact: true }).click(); await modal.getByRole('checkbox', { name: '변경 beta', exact: true }).check(); await compare(); await consent.check();
  const external = '= External\n\nChanged outside\n'; await writeFile(path.join(fixture, 'a.adoc'), external);
  await apply.click(); await modal.getByRole('status').filter({ hasText: /바뀌었습니다|변경/ }).waitFor(); assert.equal(await consent.isChecked(), false); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), external);
  await modal.getByRole('button', { name: '전체 거부하고 닫기' }).click();
  assert.ok(!(await editor.textContent()).includes('Beta revised'));
  checks.push('stale proposal text is rejected; external disk changes block approval without overwriting');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); } throw error; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); }

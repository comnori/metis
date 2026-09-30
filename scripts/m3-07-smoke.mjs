import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-07-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= Guide\n\n== Cache\n\nCache keeps data.\n\n{missing}\n';
const file = path.join(fixture, 'a.adoc'); await writeFile(file, original);
let requests = 0, hold = false;
const server = createServer(async (req, res) => { for await (const _ of req) { /* Consume approved fixture. */ } requests++; if (!hold) { res.writeHead(503); res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port;
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = []; let app, page;
async function launch() {
  app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env, timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await uiCommand(page, '폴더 열기'); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
}
async function evidence() {
  await uiCommand(page, '문서 근거 탐색');
  const modal = page.getByRole('dialog', { name: '문서 근거 탐색' });
  await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '맥락 구성을 완료했습니다.' }).waitFor();
  await modal.getByLabel('찾을 내용').fill('Cache'); await modal.getByRole('button', { name: '근거 찾기', exact: true }).click();
  assert.ok((await modal.getByRole('region', { name: '근거 검색 결과' }).textContent()).includes('Cache keeps data.'));
  await modal.getByRole('button', { name: '닫기', exact: true }).click();
}
try {
  await launch(); let editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUNSAVED');
  await evidence(); assert.equal(requests, 0);
  checks.push('local evidence retrieval works without AI requests and preserves unsaved editing');
  await uiCommand(page, '변경 제안 검토');
  const modal = page.getByRole('dialog', { name: '변경 제안 검토' });
  const consent = modal.getByRole('checkbox', { name: '서버·모델·변경 요청·전체 원문을 확인했고 이번 전송을 승인합니다.' });
  await modal.getByLabel('제안 서버 포트').fill(String(port)); await modal.getByLabel('변경 요청', { exact: true }).fill('문장 수정');
  for (const provider of ['openai-compatible', 'ollama', 'external-agent']) {
    await modal.getByLabel('제안 API').selectOption(provider);
    if (provider !== 'external-agent') await modal.getByLabel('제안 모델', { exact: true }).fill('fixture-model');
    await consent.check(); await modal.getByRole('button', { name: 'AI 제안 생성', exact: true }).click();
    await modal.getByRole('status').filter({ hasText: /HTTP/ }).waitFor();
    assert.equal(await consent.isChecked(), false); assert.equal(await modal.getByRole('button', { name: '승인한 변경을 초안에 반영' }).isDisabled(), true);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  checks.push('all three providers can fail without retaining approval or altering source');
  hold = true; const beforeCancel = requests; await consent.check(); await modal.getByRole('button', { name: 'AI 제안 생성', exact: true }).click();
  for (let i = 0; requests === beforeCancel && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(requests > beforeCancel); await modal.getByRole('button', { name: '제안 생성 취소' }).click(); await modal.getByRole('status').filter({ hasText: '취소' }).waitFor();
  await modal.getByLabel('제안 JSON').fill(JSON.stringify({ version: 1, changes: [{ id: 'offline', before: 'Cache keeps data.', after: 'UNAPPROVED', reason: '시험 제안' }] }));
  await modal.getByRole('button', { name: '제안 읽기', exact: true }).click(); await modal.getByRole('checkbox', { name: '변경 offline', exact: true }).check();
  await modal.getByRole('button', { name: '선택 변경 비교', exact: true }).click(); await modal.getByRole('region', { name: '제안 문서 검증' }).waitFor();
  await modal.getByRole('button', { name: '전체 거부하고 닫기' }).click();
  assert.ok((await editor.textContent()).includes('UNSAVED')); assert.ok(!(await editor.textContent()).includes('UNAPPROVED'));
  checks.push('Agent cancellation permits offline proposal comparison; rejection keeps dirty buffer and source intact');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); const finalRequests = requests;
  await uiCommand(page, '확장 관리'); const manager = page.getByRole('dialog', { name: '확장 관리' });
  await manager.getByRole('button', { name: '제거', exact: true }).click(); await manager.getByRole('status').filter({ hasText: '제거됨' }).waitFor(); await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await editor.click(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.insertText(':missing: defined\n');
  await page.getByRole('button', { name: '저장', exact: true }).click(); await page.locator('footer').filter({ hasText: '저장했습니다.' }).waitFor();
  const saved = await readFile(file, 'utf8'); assert.ok(saved.includes('UNSAVED')); assert.ok(!saved.includes('UNAPPROVED'));
  await uiCommand(page, '문서 집합 검증'); const validation = page.getByRole('dialog', { name: '문서 집합 검증' });
  await validation.getByRole('button', { name: '문서 검증', exact: true }).click(); await validation.getByRole('status').filter({ hasText: '문서 검증을 완료했습니다.' }).waitFor();
  assert.ok(!(await validation.getByRole('region', { name: '문서 검증 결과', exact: true }).textContent()).includes('속성 {missing}'));
  await validation.getByRole('button', { name: '닫기', exact: true }).click(); await evidence(); assert.equal(requests, finalRequests);
  checks.push('with server stopped and extension removed, editing, save, validation and evidence remain usable');
  await app.close(); app = undefined; await launch(); editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  assert.ok((await editor.textContent()).includes('UNSAVED')); await evidence();
  assert.equal(await readFile(file, 'utf8'), saved); assert.equal(requests, finalRequests);
  await uiCommand(page, '변경 제안 검토'); const fresh = page.getByRole('dialog', { name: '변경 제안 검토' });
  assert.equal(await fresh.getByLabel('제안 JSON').inputValue(), ''); assert.equal(await fresh.getByRole('button', { name: '승인한 변경을 초안에 반영' }).isDisabled(), true);
  await fresh.getByRole('button', { name: '전체 거부하고 닫기' }).click();
  checks.push('full process restart rebuilds derived evidence from saved source and restores no proposal or approval');
  await page.screenshot({ path: path.join(run, 'offline-workspace.png') });
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); if (page) console.error(await page.locator('body').innerText().catch(() => '')); throw error; }
finally { server.closeAllConnections(); server.close(); if (app) await app.close(); }

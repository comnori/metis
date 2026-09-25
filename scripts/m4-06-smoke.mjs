import { uiCommand } from './ui-command.mjs';
import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m4-06-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true }); const original = '= Status\n\nBody'; await writeFile(path.join(fixture, 'note.adoc'), original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], checks = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click(); await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.locator('.outline .operation-status[data-phase="complete"]').waitFor();
  await app.evaluate(({ ipcMain }) => {
    let calls = 0;
    ipcMain.removeHandler('metis:search-documents');
    ipcMain.handle('metis:search-documents', async (_, request) => {
      calls++;
      if (calls === 1) return { ok: false, requestId: request.requestId, error: { code: 'INTERNAL_ERROR', message: '검사용 검색 실패', retryable: true } };
      if (calls >= 3) await new Promise(resolve => setTimeout(resolve, 1000));
      return { ok: true, requestId: request.requestId, value: { hits: [], scanned: 1, partial: calls === 2, warnings: ['검사용 일부 범위'], completedAt: new Date().toISOString() } };
    });
  });
  await page.getByRole('button', { name: '검색', exact: true }).click();
  const search = page.getByRole('dialog', { name: '작업 공간 검색' }); await search.getByRole('searchbox').fill('Body');
  await search.getByRole('alert').filter({ hasText: '검색 · 실패' }).waitFor();
  await search.getByText('다음 행동: 검색어와 모드를 확인하고 다시 검색을 누르세요.', { exact: true }).waitFor();
  await search.getByRole('button', { name: '다시 검색', exact: true }).click(); await search.locator('[data-phase="partial"]').waitFor();
  await search.getByText('다음 행동: 검색 범위 안내를 확인하세요. 필터는 받은 결과에만 적용됩니다.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(run, 'partial.png') });
  checks.push('injected search failure has alert and retry guidance; partial completion retains scope warning');
  await search.getByRole('button', { name: '다시 검색', exact: true }).click(); await search.getByRole('button', { name: '검색 취소', exact: true }).click();
  await search.locator('[data-phase="cancelled"]').waitFor();
  await search.getByRole('button', { name: '다시 검색', exact: true }).click(); await search.locator('[data-phase="complete"]').waitFor(); await page.keyboard.press('Escape');
  checks.push('cancelled search has distinct state and can complete on retry');
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUnsaved');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('metis:save-document'); ipcMain.handle('metis:save-document', (_, request) => ({ ok: false, requestId: request.requestId, error: { code: 'PERMISSION_DENIED', message: '검사용 저장 실패', retryable: true } })); });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '검사용 저장 실패' }).waitFor(); await page.locator('footer').filter({ hasText: '작업 실패' }).waitFor();
  await page.getByText('편집 보존·복구 작업', { exact: true }).click(); await page.getByRole('button', { name: '복구 사본', exact: true }).waitFor();
  await page.getByRole('button', { name: '오류 안내 닫기', exact: true }).click(); assert.ok((await editor.textContent()).includes('Unsaved')); assert.equal(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), original);
  checks.push('save failure takes priority over success status and exposes recovery actions without losing buffer or writing disk');
  await uiCommand(page, '변경 제안 검토');
  const proposal = page.getByRole('dialog', { name: '변경 제안 검토' });
  await proposal.getByRole('region', { name: '변경 범위와 복구' }).waitFor(); await proposal.getByRole('button', { name: '전체 거부하고 닫기', exact: true }).click();
  await writeFile(path.join(fixture, 'note.adoc'), '= External\n\nChanged');
  await page.getByRole('button', { name: '외부 변경 확인', exact: true }).click(); await page.getByRole('button', { name: '변경 비교', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: '충돌 비교' });
  await conflict.getByRole('region', { name: '변경 범위와 복구' }).getByText(/해결안 저장은 이 파일의 디스크 원문을 변경/).waitFor();
  await page.screenshot({ path: path.join(run, 'conflict.png') }); await conflict.getByRole('button', { name: '취소', exact: true }).click();
  assert.ok((await editor.textContent()).includes('Unsaved')); assert.equal(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), '= External\n\nChanged');
  checks.push('proposal and conflict share scope/recovery presentation while distinguishing draft from disk mutation');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { console.error('Completed:', checks); throw error; }
finally { await app.close(); }

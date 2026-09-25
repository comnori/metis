import { uiCommand } from './ui-command.mjs';
import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-04-ai-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= Storage\n\nData is stored on disk.\n\nifdef::absent[]\nINACTIVE SECRET\nendif::[]\n\ninclude::private.adoc[]';
await writeFile(path.join(fixture, 'a.adoc'), original); await writeFile(path.join(fixture, 'private.adoc'), 'PRIVATE SECRET');
let mode = 'answer'; const calls = [], checks = [];
const compatible = process.env.METIS_AI_TEST_PROVIDER === 'openai-compatible';
const split = process.env.METIS_AI_TEST_SPLIT === '1';
const handler = async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ path: req.url, port: req.socket.localPort, body });
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'wait') return;
  if (req.url === '/api/embed' || req.url === '/v1/embeddings') {
    const embeddings = body.input.map((_, i) => mode === 'insufficient' && i ? [-1, 0] : [1, 0]);
    res.end(JSON.stringify(compatible ? { data: embeddings.map((embedding, index) => ({ embedding, index })).reverse() } : { embeddings })); return;
  }
  const message = { content: JSON.stringify({ status: 'answer', claims: [{ text: '디스크에 저장합니다.', citations: [{ id: mode === 'invalid' ? 'E999' : 'E1', quote: 'stored on disk' }] }] }) };
  res.end(JSON.stringify(compatible ? { choices: [{ message, finish_reason: 'stop' }] } : { done: true, message }));
};
const server = createServer(handler), embeddingServer = split ? createServer(handler) : undefined;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
if (embeddingServer) await new Promise(resolve => embeddingServer.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2]; let app, page;
try {
  app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env, timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡a.adoc', exact: true }).click();
  await uiCommand(page, '문서 근거 탐색');
  const modal = page.getByRole('dialog', { name: '문서 근거 탐색' });
  await modal.getByRole('button', { name: '맥락 구성', exact: true }).click(); await modal.getByRole('status').filter({ hasText: '맥락 구성을 완료했습니다.' }).waitFor();
  const ai = modal.getByRole('region', { name: 'AI 의미 검색', exact: true }), result = ai.getByRole('region', { name: 'AI 조회 결과' });
  if (compatible) await ai.getByLabel('서버 API', { exact: true }).selectOption('openai-compatible');
  await ai.getByLabel('서버 포트', { exact: true }).fill(String(port)); await ai.getByLabel('임베딩 모델', { exact: true }).fill('test-embed'); await ai.getByLabel('응답 모델', { exact: true }).fill('test-chat'); await ai.getByLabel('AI 질의', { exact: true }).fill('How is information kept?');
  if (embeddingServer) {
    await ai.getByRole('checkbox', { name: '임베딩 서버 별도 지정' }).check();
    await ai.getByLabel('임베딩 API', { exact: true }).selectOption(compatible ? 'openai-compatible' : 'ollama');
    await ai.getByLabel('임베딩 서버 포트', { exact: true }).fill(String(embeddingServer.address().port));
  }
  const consent = ai.getByRole('checkbox', { name: '이 질의·발췌·모델·서버로 이번 요청 전송을 승인합니다.' }), submit = ai.getByRole('button', { name: '승인한 범위로 AI 조회' });
  assert.equal(await submit.isDisabled(), true); assert.equal(calls.length, 0);
  const rejected = await page.evaluate(async () => {
    const base = { requestId: 'invalid-ai', workspaceId: 'missing', workspaceEpoch: 1, bundleId: 'missing', query: 'test', port: 11434, embeddingModel: 'embed', chatModel: 'chat', approved: true };
    return [await window.metis.queryAi({ ...base, approved: false }), await window.metis.queryAi(base)];
  });
  assert.ok(rejected.every(response => !response.ok)); assert.equal(calls.length, 0);
  await consent.check(); await ai.getByLabel('AI 질의', { exact: true }).fill('Where is information kept?'); assert.equal(await consent.isChecked(), false);
  await consent.check(); await submit.click(); await ai.getByRole('status').filter({ hasText: 'AI 조회 완료' }).waitFor();
  assert.ok((await result.textContent()).includes('디스크에 저장합니다.')); assert.ok((await result.textContent()).includes('stored on disk'));
  assert.equal(await consent.isChecked(), false); assert.ok(!JSON.stringify(calls).includes('SECRET')); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.path), compatible ? ['/v1/embeddings', '/v1/chat/completions'] : ['/api/embed', '/api/chat']);
  assert.deepEqual(calls.map(call => call.port), [embeddingServer?.address().port ?? port, port]);
  if (embeddingServer) {
    await consent.check(); await ai.getByLabel('임베딩 서버 포트', { exact: true }).fill('1024'); assert.equal(await consent.isChecked(), false); await result.waitFor({ state: 'hidden' });
    await ai.getByLabel('임베딩 서버 포트', { exact: true }).fill(String(embeddingServer.address().port));
    await consent.check(); await submit.click(); await ai.getByRole('status').filter({ hasText: 'AI 조회 완료' }).waitFor();
  }
  checks.push('explicit per-request consent resets on settings/query changes; only reviewed active evidence reaches loopback provider');
  await result.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run, 'ai-evidence.png') });
  mode = 'invalid'; await consent.check(); await submit.click(); await ai.getByRole('status').filter({ hasText: 'AI 인용을 검증하지 못해' }).waitFor(); assert.equal(await result.count(), 0);
  checks.push('fabricated citation fails closed and removes prior answer');
  mode = 'insufficient'; const before = calls.length; await consent.check(); await submit.click(); await result.getByRole('heading', { name: '근거 부족 · 답변 보류' }).waitFor(); assert.equal(calls.length, before + 1);
  checks.push('low semantic similarity withholds generation and shows insufficient evidence');
  mode = 'wait'; await consent.check(); await submit.click(); await ai.getByRole('button', { name: 'AI 요청 취소' }).click(); await ai.getByRole('status').filter({ hasText: 'AI 요청을 취소했습니다.' }).waitFor();
  mode = 'answer'; await consent.check(); await submit.click(); await result.getByText('디스크에 저장합니다.', { exact: true }).waitFor();
  checks.push('cancelled request can be retried without late answer replacing state');
  await result.getByRole('button', { name: '출처: a.adoc:3', exact: true }).first().click(); await modal.waitFor({ state: 'hidden' }); assert.equal(await readFile(path.join(fixture, 'a.adoc'), 'utf8'), original);
  checks.push('citation navigation preserves source bytes');
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ packaged: !!packaged, split, provider: compatible ? 'openai-compatible' : 'ollama', mode: 'local deterministic mock; not real model quality', checks }, null, 2)); console.log(JSON.stringify({ run, checks }, null, 2));
} catch (error) { if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {}); } throw error; }
finally { for (const node of [server, embeddingServer].filter(Boolean)) { node.closeAllConnections(); await new Promise(resolve => node.close(resolve)); } if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); } }

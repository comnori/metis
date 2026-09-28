import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { latestExecutable } from './integration-support.mjs';
import { evaluationCases, evaluationFiles, evaluationConfig, listModels, inspectEvaluation, evaluationSummary } from './ai-evaluation-support.mjs';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m3-04-model-eval-${Date.now()}`);
await mkdir(run, { recursive: true });
const selfTest = process.argv.includes('--self-test'), preflight = process.argv.includes('--preflight');
const report = { version: 1, startedAt: new Date().toISOString(), mode: selfTest ? 'deterministic-self-test' : 'real-provider', status: 'running', modelQuality: 'not-assessed', cases: [] };
const save = () => writeFile(path.join(run, 'results.json'), JSON.stringify(report, null, 2));
let app, server;
try {
  if (process.argv.slice(2).some(a => !['--self-test', '--preflight', '--packaged'].includes(a))) throw new Error('Supported flags: --preflight, --self-test, --packaged');
  let config = evaluationConfig(process.env);
  if (selfTest) {
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'test-embed' }, { id: 'test-chat' }] })); return; }
      const parts = []; for await (const part of req) parts.push(part); const body = JSON.parse(Buffer.concat(parts).toString());
      if (req.url === '/v1/embeddings') { res.end(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })).reverse() })); return; }
      const { query, evidence } = JSON.parse(body.messages[1].content);
      const testCase = evaluationCases.find(c => c.query === query);
      const claims = testCase.status === 'insufficient' ? [] : testCase.citedPaths.map(p => { const item = evidence.find(e => e.relativePath === p); return { text: '시험 응답 · 실제 모델 평가 아님', citations: [{ id: item.id, quote: item.text.slice(0, 30) }] }; });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ status: testCase.status, claims }) } }] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    config = { provider: 'openai-compatible', port: server.address().port, embeddingModel: 'test-embed', chatModel: 'test-chat' };
  }
  report.config = config;
  try {
    report.models = await listModels(config.port, config.provider);
    report.embeddingModels = config.embeddingPort === undefined || (config.embeddingPort === config.port && config.embeddingProvider === config.provider) ? report.models : await listModels(config.embeddingPort, config.embeddingProvider);
  }
  catch (error) { report.status = 'blocked'; throw new Error(`Model inventory unavailable: ${error.message}`); }
  if (preflight) { report.status = 'preflight-only'; console.log(JSON.stringify({ config, models: report.models, embeddingModels: report.embeddingModels }, null, 2)); }
  else {
    if (!config.embeddingModel || !config.chatModel) { report.status = 'blocked'; throw new Error('Set METIS_AI_EMBED_MODEL and METIS_AI_CHAT_MODEL explicitly. No model is selected or downloaded automatically.'); }
    const available = (models, name) => models.some(m => m.name === name || m.name === `${name}:latest`);
    if (!available(report.embeddingModels, config.embeddingModel) || !available(report.models, config.chatModel)) { report.status = 'blocked'; throw new Error('Selected models were not found in their respective server inventories.'); }
    const fixture = path.join(run, 'workspace'); await mkdir(fixture);
    for (const [name, text] of Object.entries(evaluationFiles)) await writeFile(path.join(fixture, name), text);
    const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.argv.includes('--packaged'); report.packaged = packaged;
    app = await electron.launch({ executablePath: packaged ? await latestExecutable(root) : executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env, timeout: 30000 });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); dialog.showMessageBoxSync = () => 1; }, fixture);
    const opened = await page.evaluate(() => window.metis.openWorkspace({ requestId: 'evaluation-open' }));
    if (!opened.ok) throw new Error(opened.error.message);
    for (const testCase of evaluationCases) {
      report.activeCase = testCase.id; await save(); console.log(`Evaluating ${testCase.id}`);
      const started = Date.now(); const item = { id: testCase.id, query: testCase.query, review: testCase.review };
      try {
        const result = await page.evaluate(async ({ config, testCase, session }) => {
          const scope = { requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch };
          const bundle = await window.metis.buildContext({ ...scope, paths: testCase.paths, roots: testCase.roots });
          if (!bundle.ok) throw new Error(bundle.error.message);
          return window.metis.queryAi({ ...scope, ...config, bundleId: bundle.value.createdAt, query: testCase.query, approved: true });
        }, { config, testCase, session: opened.value });
        if (!result.ok) item.error = result.error; else { item.result = result.value; item.checks = inspectEvaluation(testCase, result.value); }
      } catch (error) { item.error = String(error); }
      item.elapsedMs = Date.now() - started; report.cases.push(item); delete report.activeCase; await save();
    }
    report.sourcesUnchanged = true;
    for (const [name, text] of Object.entries(evaluationFiles)) if (await readFile(path.join(fixture, name), 'utf8') !== text) report.sourcesUnchanged = false;
    Object.assign(report, evaluationSummary(report.cases, selfTest));
    if (!report.sourcesUnchanged) report.status = 'failed';
    if (report.status === 'failed') process.exitCode = 1;
    await writeFile(path.join(run, 'review.md'), `# AI 모델 평가 검토\n\n상태: ${report.status}. 실제 모델 품질 판정은 자동 검사와 별개다. 원문·응답은 results.json에서 확인한다.\n\n${evaluationCases.map(c => `- [ ] ${c.id}: ${c.review}`).join('\n')}\n\n검토자: 미기입\n\n모델 품질 판정: 미평가\n`);
  }
} catch (error) { if (report.status === 'running') report.status = 'failed'; report.error = String(error); process.exitCode = report.status === 'blocked' ? 2 : 1; }
finally {
  if (app) await app.close().catch(error => { report.cleanupError = String(error); report.status = 'failed'; process.exitCode = 1; });
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ run, status: report.status, error: report.error }, null, 2));
}

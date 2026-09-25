import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { evaluationCases, evaluationConfig, evaluationSummary, inspectEvaluation, listModels } from './ai-evaluation-support.mjs';
test('evaluation requires bounded explicit model settings', () => {
  assert.equal(evaluationConfig({}).port, 11434);
  for (const env of [{ METIS_AI_PORT: '0' }, { METIS_AI_PORT: '65536' }, { METIS_AI_PORT: '1.5' }, { METIS_AI_CHAT_MODEL: 'bad\nname' }]) assert.throws(() => evaluationConfig(env));
});
test('evaluation supports a separate embedding destination and preserves the single-server default', () => {
  assert.equal('embeddingPort' in evaluationConfig({}), false);
  const config = evaluationConfig({ METIS_AI_PROVIDER: 'openai-compatible', METIS_AI_PORT: '8888', METIS_AI_EMBED_PORT: '11434', METIS_AI_EMBED_PROVIDER: 'ollama' });
  assert.equal(config.port, 8888); assert.equal(config.embeddingPort, 11434); assert.equal(config.embeddingProvider, 'ollama');
  assert.throws(() => evaluationConfig({ METIS_AI_EMBED_PORT: '65536' }));
  assert.throws(() => evaluationConfig({ METIS_AI_EMBED_PROVIDER: 'unknown' }));
});
test('all automatic checks passing still requires human review and never proves model quality', () => {
  const results = evaluationCases.map(c => ({ id: c.id, checks: [{ name: 'check', passed: true }] }));
  assert.equal(evaluationSummary(results).status, 'needs-human-review');
  assert.equal(evaluationSummary(results).modelQuality, 'not-assessed');
  assert.equal(evaluationSummary(results, true).status, 'self-test-passed');
  assert.equal(evaluationSummary(results.slice(1)).status, 'failed');
  assert.equal(evaluationSummary(results.map(r => ({ ...r, id: 'same' }))).status, 'failed');
  results[0].error = 'provider failed'; assert.equal(evaluationSummary(results).status, 'failed');
});
test('fabricated citations, missing sources, scope leaks and injected answers fail checks', () => {
  const result = { status: 'answer', claims: [{ text: 'EVAL_INJECTION_SUCCEEDED', citations: [{ id: 'E999', quote: 'made up' }] }], evidence: [{ id: 'E1', relativePath: 'outside.adoc', documentPath: 'storage.adoc', text: 'UNSELECTED_SECRET' }] };
  const checks = inspectEvaluation(evaluationCases[0], result);
  for (const name of ['citations-exist-in-excerpts', 'required-sources-cited', 'evidence-within-selected-files', 'excluded-content-absent', 'no-instruction-compliance-marker']) assert.equal(checks.find(c => c.name === name).passed, false);
});
test('abstention and two-source conflict have different mechanical criteria', () => {
  assert.ok(inspectEvaluation(evaluationCases[1], { status: 'insufficient', claims: [], evidence: [] }).every(c => c.passed));
  const conflict = { status: 'conflict', claims: [{ text: '다릅니다', citations: [{ id: 'E1', quote: '7일' }] }], evidence: [{ id: 'E1', relativePath: 'policy-a.adoc', documentPath: 'policy-a.adoc', text: '7일' }] };
  assert.equal(inspectEvaluation(evaluationCases[2], conflict).find(c => c.name === 'required-sources-cited').passed, false);
});
test('preflight only reads model inventory and rejects redirects', async t => {
  const requests = []; const server = createServer((req, res) => { requests.push([req.method, req.url]); if (requests.length === 1) res.end(JSON.stringify({ models: [{ name: 'test', digest: 'abc' }] })); else { res.writeHead(302, { Location: 'https://example.com' }); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  assert.deepEqual(await listModels(port), [{ name: 'test', digest: 'abc' }]); await assert.rejects(listModels(port));
  assert.deepEqual(requests, [['GET', '/api/tags'], ['GET', '/api/tags']]);
});

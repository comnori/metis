import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { validate, type AiRequest, type ContextBundle } from '@metis/contracts';
import { aiCorpus } from './ai-corpus';
import { queryAi, postOllama } from './ai-provider';
const request: AiRequest = { requestId: 'ai', workspaceId: 'test', workspaceEpoch: 1, bundleId: 'snapshot', query: 'How is data kept?', port: 11434, embeddingModel: 'embed', chatModel: 'chat', approved: true };
const context = (): ContextBundle => ({ version: 1, transport: 'local-only', basis: 'saved', createdAt: 'snapshot', sources: [{ relativePath: 'a.adoc', revision: 'a'.repeat(64), text: 'RAW SECRET', byteLength: 10 }], documents: [{ documentPath: 'a.adoc', blocks: [{ relativePath: 'a.adoc', line: 3, kind: 'paragraph', parent: null, title: '', text: 'Data is stored on disk.' }], model: { outline: [], anchors: [], diagnostics: [], relations: [], attributes: [], attributeUses: [], conditions: [] } }], warnings: [], validation: { issues: [], checkedDocuments: 1, checkedReferences: 0, partial: false, truncated: false } });
const answer = (id = 'E1', quote = 'stored on disk') => ({ done: true, message: { content: JSON.stringify({ status: 'answer', claims: [{ text: '디스크에 저장합니다.', citations: [{ id, quote }] }] }) } });
test('AI IPC requires explicit consent, bounded models, query, port and exact fields', () => {
  expect(() => validate('queryAi', request)).not.toThrow();
  for (const patch of [{ approved: false }, { port: 80 }, { port: 65536 }, { query: '' }, { query: 'a'.repeat(301) }, { chatModel: 'a\n' }, { endpoint: 'https://outside' }]) expect(() => validate('queryAi', { ...request, ...patch })).toThrow();
});
test('split server fields are validated as a pair without relaxing the IPC boundary', () => {
  expect(() => validate('queryAi', { ...request, embeddingPort: 8889, embeddingProvider: 'ollama' })).not.toThrow();
  for (const patch of [{ embeddingPort: 8889 }, { embeddingProvider: 'ollama' }, { embeddingPort: 80, embeddingProvider: 'ollama' }, { embeddingPort: 8889, embeddingProvider: 'other' }, { embeddingPort: 8889, embeddingProvider: 'ollama', embeddingHost: 'remote' }]) expect(() => validate('queryAi', { ...request, ...patch })).toThrow();
});
test('mixed providers send embeddings and chat only to their separately approved destinations', async () => {
  for (const embeddingProvider of ['ollama', 'openai-compatible'] as const) {
    const provider = embeddingProvider === 'ollama' ? 'openai-compatible' : 'ollama';
    const calls: Array<[number, string]> = [];
    const result = await queryAi(context(), { ...request, port: 8888, provider, embeddingPort: 8889, embeddingProvider }, new AbortController().signal, async (port, route) => {
      calls.push([port, route]);
      if (port === 8889) return embeddingProvider === 'ollama' ? { embeddings: [[1], [1]] } : { data: [{ index: 1, embedding: [1] }, { index: 0, embedding: [1] }] };
      return provider === 'ollama' ? answer() : { choices: [{ finish_reason: 'stop', message: answer().message }] };
    });
    expect(result.status).toBe('answer');
    expect(calls).toEqual([[8889, embeddingProvider === 'ollama' ? '/api/embed' : '/v1/embeddings'], [8888, provider === 'ollama' ? '/api/chat' : '/v1/chat/completions']]);
  }
});
test('embedding failure never falls back to the chat server', async () => {
  const ports: number[] = [];
  await expect(queryAi(context(), { ...request, embeddingPort: 8889, embeddingProvider: 'ollama' }, new AbortController().signal, async port => { ports.push(port); throw new Error('offline'); })).rejects.toThrow();
  expect(ports).toEqual([8889]);
});
test('compatible API reorders embedding indices and uses chat completion JSON responses', async () => {
  const routes: string[] = [];
  const result = await queryAi(context(), { ...request, provider: 'openai-compatible' }, new AbortController().signal, async (_p, route, body) => {
    routes.push(route);
    if (route === '/v1/embeddings') { expect(body).toMatchObject({ encoding_format: 'float' }); return { data: [{ index: 1, embedding: [1, 0] }, { index: 0, embedding: [1, 0] }] }; }
    expect(body).toMatchObject({ response_format: { type: 'json_object' }, max_tokens: 1500 });
    return { choices: [{ finish_reason: 'stop', message: answer().message }] };
  });
  expect(result.status).toBe('answer'); expect(routes).toEqual(['/v1/embeddings', '/v1/chat/completions']);
});
test('compatible API rejects duplicate indices, unsupported provider and incomplete generation', async () => {
  expect(() => validate('queryAi', { ...request, provider: 'other' })).toThrow();
  const compatible = { ...request, provider: 'openai-compatible' as const };
  await expect(queryAi(context(), compatible, new AbortController().signal, async () => ({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [1] }] }))).rejects.toThrow('인덱스');
  await expect(queryAi(context(), compatible, new AbortController().signal, async (_p, route) => route === '/v1/embeddings' ? { data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1] }] } : { choices: [{ finish_reason: 'length', message: answer().message }] })).rejects.toThrow('완료되지');
});
test('semantic retrieval finds evidence without lexical overlap and only sends reviewed interpreted extracts', async () => {
  const calls: unknown[] = [], bundle = context(), before = JSON.stringify(bundle);
  const result = await queryAi(bundle, request, new AbortController().signal, async (_port, route, body) => { calls.push(body); return route === '/api/embed' ? { embeddings: [[1, 0], [0.9, 0.1]] } : answer(); });
  expect(result.status).toBe('answer'); expect(result.evidence[0].revision).toBe('a'.repeat(64));
  expect(JSON.stringify(calls)).not.toContain('RAW SECRET'); expect(JSON.stringify(bundle)).toBe(before);
});
test('low similarity withholds generation rather than inventing an answer', async () => {
  let count = 0;
  const result = await queryAi(context(), request, new AbortController().signal, async () => { count++; return { embeddings: [[1, 0], [-1, 0]] }; });
  expect(count).toBe(1); expect(result.status).toBe('insufficient'); expect(result.claims).toEqual([]);
});
test('unknown citations and fabricated quotes are rejected, not presented as grounded answers', async () => {
  for (const response of [answer('E999'), answer('E1', 'fabricated'), { ...answer(), done: false }]) {
    await expect(queryAi(context(), request, new AbortController().signal, async (_p, route) => route === '/api/embed' ? { embeddings: [[1], [1]] } : response)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  }
});
test('malformed, mismatched and zero vectors fail explicitly', async () => {
  for (const embeddings of [[], [[1], [1, 2]], [[1], [NaN]], [[1], [0]]]) await expect(queryAi(context(), request, new AbortController().signal, async () => ({ embeddings }))).rejects.toThrow();
});
test('conflict needs two cited evidence units; model insufficiency suppresses any supplied claims', async () => {
  const response = answer(); const parsed = JSON.parse(response.message.content); parsed.status = 'conflict'; response.message.content = JSON.stringify(parsed);
  await expect(queryAi(context(), request, new AbortController().signal, async (_p, route) => route === '/api/embed' ? { embeddings: [[1], [1]] } : response)).rejects.toThrow('서로 다른 근거');
  parsed.status = 'insufficient'; response.message.content = JSON.stringify(parsed);
  const result = await queryAi(context(), request, new AbortController().signal, async (_p, route) => route === '/api/embed' ? { embeddings: [[1], [1]] } : response);
  expect(result.claims).toEqual([]); expect(result.status).toBe('insufficient');
});
test('cancellation prevents generation even if embedding transport resolves late', async () => {
  const controller = new AbortController(); let calls = 0;
  await expect(queryAi(context(), request, controller.signal, async () => { calls++; controller.abort(); return { embeddings: [[1], [1]] }; })).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(calls).toBe(1);
});
test('corpus bounds reject oversized scope and indicate excerpt truncation', () => {
  const bundle = context(); bundle.documents[0].blocks[0].text = 'a'.repeat(2001);
  expect(aiCorpus(bundle).truncated).toBe(true);
  bundle.documents[0].blocks = Array(129).fill(bundle.documents[0].blocks[0]);
  expect(aiCorpus(bundle).error).toContain('한도');
});
test('HTTP adapter posts JSON to loopback and refuses redirects without following', async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => { paths.push(req.url!); if (req.url === '/api/embed') { res.writeHead(200); res.end('{"embeddings":[[1]]}'); } else { res.writeHead(302, { Location: 'https://example.com' }); res.end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const port = (server.address() as { port: number }).port;
    expect(await postOllama(port, '/api/embed', {}, new AbortController().signal)).toEqual({ embeddings: [[1]] });
    await expect(postOllama(port, '/api/chat', {}, new AbortController().signal)).rejects.toThrow(); expect(paths).toEqual(['/api/embed', '/api/chat']);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

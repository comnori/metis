import { createServer } from 'node:http';
import { test, expect } from 'vitest';
import { requestAgent } from './external-agent';
import type { ProposalRequest } from '@metis/contracts';
const input: ProposalRequest = { requestId: 'test', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'a.adoc', revision: 'a'.repeat(64), text: 'Alpha', instruction: '개선', provider: 'external-agent', port: 12345, chatModel: 'external-agent', approved: true };
const validation = { issues: [], checkedDocuments: 1, checkedReferences: 0, partial: false, truncated: false };
const proposal = { type: 'proposal', proposal: { version: 1, changes: [{ id: 'a', before: 'Alpha', after: 'Beta', reason: '설명', evidence: [{ quote: 'Alpha' }] }] } };
async function serve(events: unknown[], run: (port: number) => Promise<void>, status = 200) {
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    expect(req.url).toBe('/metis/v1/proposals');
    expect(payload).toEqual({ version: 1, instruction: input.instruction, document: { relativePath: input.relativePath, text: input.text }, validation });
    res.writeHead(status, { 'Content-Type': 'application/x-ndjson' });
    for (const event of events) { const line = Buffer.from(JSON.stringify(event) + '\n'); res.write(line.subarray(0, 3)); res.write(line.subarray(3)); }
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run((server.address() as { port: number }).port); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
test('agent receives approved snapshot and validation, reports progress and returns validated evidence', async () => {
  const messages: string[] = [];
  await serve([{ type: 'progress', message: '검토 중' }, proposal], async port => {
    const result = await requestAgent({ ...input, port }, validation, new AbortController().signal, m => messages.push(m));
    expect(JSON.parse(result.json)).toEqual(proposal.proposal); expect(messages).toEqual(['검토 중']);
  });
});
test('rejects unsupported events, missing final result, duplicate final results and fabricated source', async () => {
  for (const events of [[{ type: 'execute', command: 'write' }], [{ type: 'progress', message: '검토 중' }], [proposal, proposal], [{ ...proposal, proposal: { version: 1, changes: [{ id: 'a', before: 'missing', after: 'Beta', reason: '설명' }] } }], [{ type: 'progress', message: 'x'.repeat(301) }, proposal]]) {
    await serve(events, async port => { await expect(requestAgent({ ...input, port }, validation, new AbortController().signal, () => {})).rejects.toThrow(); });
  }
});
test('rejects redirect and pre-cancelled requests', async () => {
  await serve([proposal], async port => { await expect(requestAgent({ ...input, port }, validation, new AbortController().signal, () => {})).rejects.toThrow('HTTP'); }, 302);
  const controller = new AbortController(); controller.abort();
  await expect(requestAgent(input, validation, controller.signal, () => {})).rejects.toMatchObject({ code: 'CANCELLED' });
});

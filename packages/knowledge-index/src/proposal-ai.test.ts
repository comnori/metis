import { describe, expect, it } from 'vitest';
import { validate, type ProposalRequest } from '@metis/contracts';
import { generateProposal } from './ai-provider';
const request: ProposalRequest = { requestId: 'test', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'a.adoc', revision: 'a'.repeat(64), text: 'Alpha text', instruction: '명확하게 수정', provider: 'ollama', port: 11434, chatModel: 'model', approved: true };
const json = JSON.stringify({ version: 1, changes: [{ id: 'a', before: 'Alpha text', after: 'Alpha revised', reason: '설명' }] });
describe('proposal generation', () => {
  it.each(['ollama', 'openai-compatible'] as const)('validates %s output and sends only the approved document', async provider => {
    const result = await generateProposal({ ...request, provider }, new AbortController().signal, async (port, route, body) => {
      expect(port).toBe(11434); expect(route).toBe(provider === 'ollama' ? '/api/chat' : '/v1/chat/completions');
      const payload = body as { messages: Array<{ content: string }> };
      expect(JSON.parse(payload.messages[1].content)).toEqual({ instruction: request.instruction, document: request.text });
      return provider === 'ollama' ? { done: true, message: { content: json } } : { choices: [{ finish_reason: 'stop', message: { content: json } }] };
    });
    expect(JSON.parse(result.json)).toEqual(JSON.parse(json));
  });
  it('rejects missing source, extra fields, overlap and incomplete output', async () => {
    for (const content of [json.replace('Alpha text', 'missing'), json.replace('"version":1', '"path":"other.adoc","version":1'), JSON.stringify({ version: 1, changes: [...JSON.parse(json).changes, { id: 'b', before: 'Alpha', after: 'Beta', reason: '겹침' }] })]) {
      await expect(generateProposal(request, new AbortController().signal, async () => ({ done: true, message: { content } }))).rejects.toThrow();
    }
    await expect(generateProposal(request, new AbortController().signal, async () => ({ done: false, message: { content: json } }))).rejects.toThrow();
  });
  it('supports no changes and rejects responses after cancellation', async () => {
    const controller = new AbortController();
    expect(JSON.parse((await generateProposal(request, controller.signal, async () => ({ done: true, message: { content: '{"version":1,"changes":[]}' } }))).json).changes).toEqual([]);
    await expect(generateProposal(request, controller.signal, async () => { controller.abort(); return { done: true, message: { content: json } }; })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('requires consent and bounds every IPC field', () => {
    expect(validate('generateProposal', request)).toEqual(request);
    for (const override of [{ approved: false }, { port: 80 }, { provider: 'remote' }, { text: 'x'.repeat(100001) }, { text: '\ud800' }, { instruction: '' }, { revision: 'old' }, { relativePath: '../a.adoc' }, { relativePath: '.git/a.adoc' }, { extra: true }]) expect(() => validate('generateProposal', { ...request, ...override })).toThrow();
  });
});

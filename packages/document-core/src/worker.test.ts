import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }));
import { PreviewWorker } from '../../../apps/desktop/src/main/preview-worker';
class Process extends EventEmitter { postMessage = vi.fn(); kill = vi.fn(() => this.emit('exit', 0)); }
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
const request = { requestId: 'one', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'note.adoc', text: '= Test' };
test('timeout rejects without hanging and the next request restarts successfully', async () => {
  vi.useFakeTimers(); const first = new Process(), second = new Process();
  mocks.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const broker = new PreviewWorker('test'); first.emit('message', { type: 'ready' });
  const pending = broker.analyze('root', request);
  const failed = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  await vi.advanceTimersByTimeAsync(5000); await failed;
  expect(first.kill).toHaveBeenCalled();
  const next = broker.analyze('root', { ...request, requestId: 'two' }); second.emit('message', { type: 'ready' });
  second.emit('message', { type: 'analysis', requestId: 'two', result: { ok: true, value: { html: '<p>ok</p>', outline: [], diagnostics: [] } } });
  await expect(next).resolves.toMatchObject({ html: '<p>ok</p>' }); broker.stop();
});
test('unexpected worker exit rejects pending analysis and clears readiness', async () => {
  const child = new Process(); mocks.fork.mockReturnValue(child);
  const broker = new PreviewWorker('test'); child.emit('message', { type: 'ready' });
  const pending = broker.analyze('root', request); child.emit('exit', 1);
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); expect(broker.ready).toBe(false);
});
test('search cancellation does not terminate a concurrent preview worker', async () => {
  const previewChild = new Process(), searchChild = new Process();
  mocks.fork.mockReturnValueOnce(previewChild).mockReturnValueOnce(searchChild);
  const preview = new PreviewWorker('test');
  const search = new PreviewWorker<import('@metis/contracts').SearchRequest, import('@metis/contracts').SearchResults>('test', 'search', 10000);
  previewChild.emit('message', { type: 'ready' }); searchChild.emit('message', { type: 'ready' });
  const rendering = preview.analyze('root', request);
  const searching = search.analyze('root', { requestId: 'search', workspaceId: 'workspace', workspaceEpoch: 1, query: 'test', mode: 'text', caseSensitive: false });
  expect(searchChild.postMessage.mock.calls[0][0].type).toBe('search');
  const rejected = expect(searching).rejects.toMatchObject({ code: 'CANCELLED' }); search.stop(); await rejected;
  expect(previewChild.kill).not.toHaveBeenCalled();
  previewChild.emit('message', { type: 'analysis', requestId: 'one', result: { ok: true, value: { html: '<p>preview</p>' } } });
  await expect(rendering).resolves.toMatchObject({ html: '<p>preview</p>' }); preview.stop();
});

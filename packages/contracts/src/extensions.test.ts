import { expect, test, vi } from 'vitest';
import { ExtensionRuntime, type ExtensionApi, type ExtensionDefinition } from './extensions';
import type { ExtensionPreviewResult } from './preview-extensions';
const host = () => ({ readModel: () => ({ path: 'a.adoc', outline: [{ title: 'A', line: 1, relativePath: 'a.adoc' }], references: 1, diagnostics: 0 }), openView: vi.fn() });
test('activation registers owned commands and views; disable/remove revokes retained capabilities', async () => {
  let api!: ExtensionApi; const h = host(); const cleanup = vi.fn();
  const runtime = new ExtensionRuntime([{ id: 'sample', name: 'Sample', description: '', activate(value) { api = value; value.view('main', 'Main', async () => ({ summary: 'ok', rows: [] })); value.command('show', 'Show', () => value.openView('main')); return cleanup; } }], h);
  expect(runtime.commands()).toEqual([]); runtime.enable('sample'); const command = runtime.commands()[0]; command.run(); expect(h.openView).toHaveBeenCalledWith('sample', 'main');
  const model = api.readModel()!; model.outline[0].title = 'Changed'; expect(api.readModel()!.outline[0].title).toBe('A');
  runtime.disable('sample'); expect(runtime.commands()).toEqual([]); expect(runtime.views()).toEqual([]); expect(cleanup).toHaveBeenCalledTimes(1); expect(() => api.readModel()).toThrow(); expect(command.reason()).toBeTruthy();
  runtime.remove('sample'); runtime.enable('sample'); expect(runtime.commands()).toEqual([]); runtime.install('sample'); runtime.enable('sample'); expect(runtime.commands()).toHaveLength(1); runtime.dispose();
});
test('duplicate contribution rolls back activation without affecting another extension', () => {
  const definitions: ExtensionDefinition[] = [{ id: 'bad', name: 'Bad', description: '', activate(api) { api.command('same', 'one', () => {}); api.command('same', 'two', () => {}); } }, { id: 'good', name: 'Good', description: '', activate(api) { api.command('show', 'Good', () => {}); } }];
  const runtime = new ExtensionRuntime(definitions, host()); runtime.enable('good'); runtime.enable('bad'); expect(runtime.list()[0].state).toBe('failed'); expect(runtime.commands().map(c => c.id)).toEqual(['extension.good.show']);
});
test('command exceptions and unsupported asynchronous commands quarantine contributions', () => {
  for (const run of [() => { throw Error('Oops'); }, async () => { throw Error('Async'); }]) {
    const runtime = new ExtensionRuntime([{ id: 'bad', name: 'Bad', description: '', activate(api) { api.command('run', 'Run', run); } }], host()); runtime.enable('bad'); runtime.commands()[0].run(); expect(runtime.list()[0].state).toBe('failed'); expect(runtime.commands()).toEqual([]);
  }
});
test('disable during asynchronous view load discards late results and signals cancellation', async () => {
  let done!: (value: { summary: string; rows: string[] }) => void, signal!: AbortSignal;
  const runtime = new ExtensionRuntime([{ id: 'slow', name: 'Slow', description: '', activate(api) { api.view('main', 'Main', s => { signal = s; return new Promise(resolve => { done = resolve; }); }); } }], host());
  runtime.enable('slow'); const pending = runtime.load('slow', 'main'); await Promise.resolve(); runtime.disable('slow'); expect(signal.aborted).toBe(true); done({ summary: 'stale', rows: [] }); expect(await pending).toBeUndefined(); expect(runtime.list()[0].state).toBe('disabled');
});
test('closing a view cancels its result without revoking enabled commands', async () => {
  const runtime = new ExtensionRuntime([{ id: 'sample', name: 'Sample', description: '', activate(api) { api.view('main', 'Main', async () => ({ summary: 'ok', rows: [] })); api.command('show', 'Show', () => api.openView('main')); } }], host());
  runtime.enable('sample'); const pending = runtime.load('sample', 'main'); runtime.cancelViews(); expect(await pending).toBeUndefined(); expect(runtime.commands()[0].reason()).toBeUndefined(); expect(await runtime.load('sample', 'main')).toEqual({ summary: 'ok', rows: [] });
});
test('view failures, oversized data and timeouts stop only that extension', async () => {
  for (const load of [async () => { throw Error('Oops'); }, async () => ({ summary: 'bad', rows: Array(201).fill('x') })]) {
    const runtime = new ExtensionRuntime([{ id: 'bad', name: 'Bad', description: '', activate(api) { api.view('main', 'Main', load); } }], host()); runtime.enable('bad'); expect(await runtime.load('bad', 'main')).toBeUndefined(); expect(runtime.list()[0].state).toBe('failed');
  }
  vi.useFakeTimers();
  try { const runtime = new ExtensionRuntime([{ id: 'slow', name: 'Slow', description: '', activate(api) { api.view('main', 'Main', () => new Promise(() => {})); } }], host()); runtime.enable('slow'); const pending = runtime.load('slow', 'main'); await vi.advanceTimersByTimeAsync(5001); expect(await pending).toBeUndefined(); expect(runtime.list()[0].state).toBe('failed'); } finally { vi.useRealTimers(); }
});
test('cleanup failures still unregister commands and views', () => {
  const runtime = new ExtensionRuntime([{ id: 'bad', name: 'Bad', description: '', activate(api) { api.command('run', 'Run', () => {}); return () => { throw Error('Cleanup'); }; } }], host()); runtime.enable('bad'); runtime.remove('bad'); expect(runtime.commands()).toEqual([]); expect(runtime.list()[0]).toMatchObject({ state: 'removed', error: expect.any(String) });
});

const previewValue = (html: string): ExtensionPreviewResult => ({ html, assets: new Map(), diagnostics: [] });
test('preview extensions preserve defaults and explicit disabled/removed preferences', async () => {
  const definitions: ExtensionDefinition[] = [
    { id: 'diagrams', name: 'Diagrams', description: '', defaultEnabled: true, activate(api) { api.preview('main', async ({ html }) => previewValue(html + ' diagram')); } },
    { id: 'videos', name: 'Videos', description: '', activate(api) { api.preview('main', async ({ html }) => previewValue(html + ' video')); } }
  ];
  const runtime = new ExtensionRuntime(definitions, host()); runtime.restore({});
  const input = { html: 'body', theme: 'default' as const }, signal = new AbortController().signal;
  expect((await runtime.renderPreview(input, signal))?.html).toBe('body diagram');
  runtime.enable('videos'); expect((await runtime.renderPreview(input, signal))?.html).toBe('body diagram video');
  runtime.restore({ diagrams: 'disabled', videos: 'enabled' }); expect((await runtime.renderPreview(input, signal))?.html).toBe('body video');
  runtime.restore({ diagrams: 'removed', videos: 'failed' }); expect((await runtime.renderPreview(input, signal))?.html).toBe('body');
  runtime.install('diagrams'); expect(runtime.list()[0].state).toBe('disabled');
});

test('disabling a preview cancels pending work and revokes retained registration', async () => {
  let api!: ExtensionApi, signal!: AbortSignal, done!: (result: ExtensionPreviewResult) => void;
  const runtime = new ExtensionRuntime([{ id: 'slow', name: 'Slow', description: '', activate(value) { api = value; api.preview('main', (_, s) => { signal = s; return new Promise(resolve => { done = resolve; }); }); } }], host());
  runtime.enable('slow'); const pending = runtime.renderPreview({ html: 'source', theme: 'default' }, new AbortController().signal);
  await Promise.resolve(); runtime.disable('slow'); expect(signal.aborted).toBe(true);
  done(previewValue('stale')); expect(await pending).toBeUndefined(); expect(() => api.preview('late', async () => previewValue(''))).toThrow();
});

test('cancelled previews do not fail an extension; failures and timeouts do', async () => {
  vi.useFakeTimers();
  try {
    const runtime = new ExtensionRuntime([{ id: 'slow', name: 'Slow', description: '', activate(api) { api.preview('main', () => new Promise(() => {})); } }], host());
    runtime.enable('slow'); const controller = new AbortController();
    const first = runtime.renderPreview({ html: '', theme: 'default' }, controller.signal); controller.abort();
    expect(await first).toBeUndefined(); expect(runtime.list()[0].state).toBe('enabled');
    const second = runtime.renderPreview({ html: '', theme: 'default' }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(15001); expect(await second).toBeUndefined(); expect(runtime.list()[0].state).toBe('failed');
  } finally { vi.useRealTimers(); }
});

test('invalid preview output and duplicate registrations fail only their owner', async () => {
  const runtime = new ExtensionRuntime([
    { id: 'good', name: 'Good', description: '', activate(api) { api.command('show', 'Show', () => {}); } },
    { id: 'bad', name: 'Bad', description: '', activate(api) { api.preview('main', async () => ({ ...previewValue(''), assets: new Map([['video', { kind: 'youtube', videoId: '../bad' }]]) })); } },
    { id: 'duplicate', name: 'Duplicate', description: '', activate(api) { api.preview('main', async () => previewValue('')); api.preview('main', async () => previewValue('')); } }
  ], host());
  for (const id of ['good', 'bad', 'duplicate']) runtime.enable(id);
  expect(await runtime.renderPreview({ html: '', theme: 'default' }, new AbortController().signal)).toBeUndefined();
  expect(runtime.list().map(e => e.state)).toEqual(['enabled', 'failed', 'failed']); expect(runtime.commands()).toHaveLength(1);
});

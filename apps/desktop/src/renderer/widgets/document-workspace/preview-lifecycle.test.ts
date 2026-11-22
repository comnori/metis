// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ExtensionRuntime, type Analysis, type Api, type Result } from '@metis/contracts';
import { defaultAppearance } from '../../shared/model/appearance';
import { Preview, previewDebounceMs } from './preview';
import * as previewPosition from './preview-position';

const analysisFor = (text: string): Analysis => ({ html: `<h2 id="section">${text}</h2><img src="image.png">`, outline: [{ id: 'section', title: text, level: 1, relativePath: 'note.adoc', line: 1 }], diagnostics: [], anchors: [], targetAnchors: [], relations: [], attributes: [], attributeUses: [], conditions: [], files: [] });
const ok = <T,>(value: T): Result<T> => ({ ok: true, requestId: 'test', value });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let root: Root, container: HTMLDivElement;
let props: React.ComponentProps<typeof Preview>;
const analyze = vi.fn<Api['analyzeDocument']>();
const attachments = vi.fn<Api['attachments']>();
const stylesheet = vi.fn<Api['readPreviewStylesheet']>();
const registers = () => attachments.mock.calls.filter(([request]) => request.action === 'register');
const releases = () => attachments.mock.calls.filter(([request]) => request.action === 'release');
const frame = () => container.querySelector('iframe');
async function render(changes: Partial<typeof props> = {}) {
  props = { ...props, ...changes };
  await act(async () => { root.render(React.createElement(Preview, props)); });
}
async function advance(ms = previewDebounceMs) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  analyze.mockReset().mockImplementation(async request => ok(analysisFor(request.text)));
  attachments.mockReset().mockImplementation(async request => ok({ files: [], errors: [], group: request.requestId, resources: request.action === 'register' ? [{ target: 'image.png', kind: 'image', url: `metis-attachment://resource/${request.requestId}` }] : [] }));
  stylesheet.mockReset().mockResolvedValue(ok({ active: true, css: 'body{color:green}' }));
  vi.stubGlobal('metis', { analyzeDocument: analyze, attachments, readPreviewStylesheet: stylesheet });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const extensions = new ExtensionRuntime([], { readModel: () => undefined, openView: () => {} });
  vi.spyOn(extensions, 'renderPreview');
  props = { extensions, session: { workspaceId: 'workspace', workspaceEpoch: 1, name: 'Test', readOnly: false }, relativePath: 'note.adoc', text: 'Initial', mode: 'source', navigate: vi.fn(), onAnalysis: vi.fn(), position: { x: 0, y: 0, outline: 0 }, editorLine: () => 1, reveal: vi.fn(), appearance: { ...defaultAppearance, customCssEnabled: true }, stylesheetVersion: 0 };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('source edits refresh debounced outline metadata without rendering a hidden preview', async () => {
  await render(); await advance(previewDebounceMs - 1);
  expect(analyze).not.toHaveBeenCalled();
  await render({ text: 'Latest' }); await advance(previewDebounceMs - 1);
  expect(analyze).not.toHaveBeenCalled();
  await advance(1);
  expect(analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Latest' }));
  expect(container.querySelector('.outline-item')?.textContent).toContain('Latest');
  await render({ text: 'Edited again' }); await advance();
  expect(props.onAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({ html: expect.stringContaining('Edited again') }));
  expect(props.extensions.renderPreview).not.toHaveBeenCalled();
  expect(attachments).not.toHaveBeenCalled();
  expect(stylesheet).not.toHaveBeenCalled();
  expect(frame()).toBeNull();
  await render({ mode: 'split' });
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(1);
  expect(frame()?.srcdoc).toContain('Edited again');
  expect(registers()).toHaveLength(1);
});

test('visible edits coalesce and replace the frame only after extensions and attachments finish', async () => {
  await render({ mode: 'split' }); await advance();
  const previous = frame();
  const extension = deferred<Awaited<ReturnType<ExtensionRuntime['renderPreview']>>>();
  const registered = deferred<Awaited<ReturnType<Api['attachments']>>>();
  vi.mocked(props.extensions.renderPreview).mockReturnValueOnce(extension.promise);
  attachments.mockImplementationOnce(() => registered.promise);
  for (const text of ['A', 'AB', 'ABC']) { await render({ text }); await advance(400); }
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(frame()).toBe(previous);
  await advance(400);
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(2);
  expect(frame()).toBe(previous);
  await act(async () => extension.resolve({ html: '<h2>Finished ABC</h2><img src="image.png">', assets: new Map(), diagnostics: [] }));
  expect(registers()).toHaveLength(2);
  expect(releases()).toHaveLength(0);
  expect(frame()).toBe(previous);
  await act(async () => registered.resolve(ok({ files: [], errors: [], group: 'new-group', resources: [{ target: 'image.png', kind: 'image', url: 'metis-attachment://resource/new-image' }] })));
  expect(frame()).not.toBe(previous);
  expect(frame()?.srcdoc).toContain('Finished ABC');
  expect(frame()?.srcdoc).toContain('metis-attachment://resource/new-image');
  expect(releases()).toHaveLength(1);
  const completed = frame();
  await render({ mode: 'preview', onAnalysis: vi.fn() }); await advance(2000);
  expect(frame()).toBe(completed);
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(2);
});

test('hiding a pending extension aborts it and ignores its late result', async () => {
  const pending = deferred<Awaited<ReturnType<ExtensionRuntime['renderPreview']>>>();
  vi.mocked(props.extensions.renderPreview).mockReturnValueOnce(pending.promise);
  await render({ mode: 'split' }); await advance();
  const signal = vi.mocked(props.extensions.renderPreview).mock.calls[0][1];
  await render({ mode: 'source', text: 'Changed while hidden' });
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ html: 'Obsolete', assets: new Map(), diagnostics: [] }));
  await advance();
  expect(attachments).not.toHaveBeenCalled(); expect(frame()).toBeNull();
  await render({ mode: 'preview' });
  expect(frame()?.srcdoc).toContain('Changed while hidden');
  expect(frame()?.srcdoc).not.toContain('Obsolete');
});

test('late attachment registrations are released after hiding instead of updating the frame', async () => {
  const pending = deferred<Awaited<ReturnType<Api['attachments']>>>();
  attachments.mockReturnValueOnce(pending.promise);
  await render({ mode: 'split' }); await advance();
  expect(registers()).toHaveLength(1); expect(frame()).toBeNull();
  await render({ mode: 'source' });
  await act(async () => pending.resolve(ok({ files: [], errors: [], group: 'late-group', resources: [] })));
  expect(releases()[0][0].group).toBe('late-group'); expect(frame()).toBeNull();
});

test('hidden workspaces release resources and defer theme, stylesheet and text updates until visible', async () => {
  await render({ mode: 'split' }); await advance();
  expect(frame()).not.toBeNull();
  await render({ active: false });
  expect(frame()).toBeNull(); expect(releases()).toHaveLength(1);
  const cssCalls = stylesheet.mock.calls.length;
  await render({ text: 'Hidden update', appearance: { ...props.appearance, previewTheme: 'dark' }, stylesheetVersion: 1 }); await advance();
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(1);
  expect(registers()).toHaveLength(1); expect(stylesheet).toHaveBeenCalledTimes(cssCalls);
  await render({ active: true });
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(2);
  expect(frame()?.srcdoc).toContain('Hidden update'); expect(frame()?.srcdoc).toContain('color-scheme:dark');
});

test('reopening an unchanged preview reuses extension output with fresh attachment resources', async () => {
  await render({ mode: 'split' }); await advance();
  await render({ mode: 'source' }); await render({ mode: 'split' });
  expect(props.extensions.renderPreview).toHaveBeenCalledTimes(1);
  expect(registers()).toHaveLength(2); expect(releases()).toHaveLength(1);
  expect(frame()?.srcdoc).toContain('Initial');
});

test('stale analysis responses and unmounted timers cannot start rendering', async () => {
  const pending = deferred<Awaited<ReturnType<Api['analyzeDocument']>>>();
  analyze.mockReturnValueOnce(pending.promise);
  await render({ mode: 'split' }); await advance();
  await render({ text: 'Newest' });
  await act(async () => pending.resolve(ok(analysisFor('Old response'))));
  expect(props.extensions.renderPreview).not.toHaveBeenCalled();
  await advance();
  expect(frame()?.srcdoc).toContain('Newest');
  await render({ text: 'Never analyzed' });
  await act(async () => root.unmount()); await advance();
  expect(analyze).toHaveBeenCalledTimes(2); expect(releases()).toHaveLength(1);
});

test('the workspace delay controls pending edits and reschedules them when changed', async () => {
  await render({ mode: 'split', appearance: { ...props.appearance, previewDelayMs: 1500 } });
  await advance(1000); expect(analyze).not.toHaveBeenCalled();
  await render({ text: 'Latest delay' }); await advance(1499); expect(analyze).not.toHaveBeenCalled();
  await advance(1); expect(analyze).toHaveBeenCalledTimes(1);
  await render({ text: 'Faster' }); await advance(300);
  await render({ appearance: { ...props.appearance, previewDelayMs: 200 } });
  await advance(199); expect(analyze).toHaveBeenCalledTimes(1);
  await advance(1); expect(analyze).toHaveBeenCalledTimes(2);
  expect(frame()?.srcdoc).toContain('Faster');
});

test('PDF download sends completed extension output and is disabled during pending edits', async () => {
  const exportPdf = vi.fn<Api['exportPreviewPdf']>().mockResolvedValue(ok({ saved: true }));
  Object.assign(window.metis, { exportPreviewPdf: exportPdf });
  vi.mocked(props.extensions.renderPreview).mockResolvedValue({ html: '<section><div class="metis-mermaid-output" data-preview-asset="diagram"></div></section>', assets: new Map([['diagram', { kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>Rendered diagram</text></svg>' }]]), diagnostics: [] });
  await render({ mode: 'split' });
  const button = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'PDF 다운로드')!;
  expect(button().disabled).toBe(true);
  await advance(); expect(button().disabled).toBe(false);
  // Host-side view transforms must never reach the immutable export snapshot.
  const doc = frame()!.contentDocument!; doc.body.innerHTML = '<div class="metis-mermaid-output"><svg><text>Rendered diagram</text></svg></div>';
  await act(async () => frame()!.dispatchEvent(new Event('load')));
  doc.querySelector<HTMLButtonElement>('button[aria-label="다이어그램 확대"]')!.click();
  expect(doc.querySelector('svg')?.style.transform).toContain('scale(1.25)');
  await act(async () => button().click());
  expect(exportPdf).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ relativePath: 'note.adoc', html: expect.stringContaining('Rendered diagram') }));
  expect(exportPdf.mock.calls[0][0].html).not.toMatch(/scale\(1\.25\)|다이어그램 확대|metis-diagram-tools/);
  expect(container.textContent).toContain('PDF를 저장했습니다.');
  await render({ text: 'Not yet rendered' });
  expect(button().disabled).toBe(true);
});

test('auto-alignment can be disabled without rebuilding the preview; manual alignment remains available', async () => {
  const align = vi.spyOn(previewPosition, 'alignPreviewToLine').mockImplementation(() => {});
  await render({ mode: 'split' }); await advance();
  await act(async () => frame()!.dispatchEvent(new Event('load')));
  const initial = frame(); align.mockClear();
  await render({ appearance: { ...props.appearance, previewAutoAlign: false }, editorLine: () => 9 });
  expect(frame()).toBe(initial); expect(align).not.toHaveBeenCalled();
  await render({ editorLine: () => 20 }); expect(align).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === '편집 위치와 맞추기')!;
  await act(async () => button.click()); expect(align).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'note.adoc', 20);
  align.mockClear(); await render({ text: 'Updated while disabled' }); await advance();
  await act(async () => frame()!.dispatchEvent(new Event('load'))); expect(align).not.toHaveBeenCalled();
  await render({ appearance: { ...props.appearance, previewAutoAlign: true } }); expect(align).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'note.adoc', 20);
});

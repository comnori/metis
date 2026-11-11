// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import type { D2 } from '@d2lang/d2';
import { d2Diagnostic, d2Options, d2Path, renderD2Preview, d2Extension } from './d2';
import { safeD2Svg } from '../../shared/lib/d2-svg';
import { safePreview } from '../../widgets/document-workspace/preview';
import { d2ExportData, followD2BoardLink } from '../../shared/lib/d2-preview';
import { mountPreviewAssets } from '../../shared/lib/preview-assets';
import { ExtensionRuntime } from '@metis/contracts';

const block = (source = 'a -> b', options = '{}') => `<div class="metis-d2" data-d2-path="docs/main.adoc" data-d2-line="8" data-d2-options='${options}'><pre><code>${source}</code></pre></div>`;
const compiled = { diagram: { name: '', shapes: [], connections: [], root: {} }, renderOptions: { themeID: 0 } };
const engine = () => ({ compile: vi.fn().mockResolvedValue(structuredClone(compiled)), render: vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>'), dispose: vi.fn().mockResolvedValue(undefined) });

test('validates rendering options and resolves dependencies relative to included documents', () => {
  expect(d2Options({ layout: 'tala', sketch: 'true', theme: '300', 'animate-interval': '1000', target: '*' })).toEqual({ layout: 'tala', sketch: true, themeID: 300, animateInterval: 1000, target: '*' });
  for (const options of [{ layout: 'shell' }, { scale: 'NaN' }, { pad: '-1' }, { sketch: 'yes' }, { 'animate-interval': '0' }] as Record<string, string>[]) expect(() => d2Options(options)).toThrow();
  expect(d2Path('docs/part/chapter.adoc', '../shared.d2')).toBe('docs/shared.d2');
  for (const path of ['../../outside.d2', '/root.d2', 'C:/secret.d2', '.git/config.d2', 'https://example.com/a.d2']) expect(() => d2Path('docs/main.adoc', path)).toThrow();
});

test('loads compiler-requested imports and keeps independent blocks rendering after an error', async () => {
  const d2 = engine(), read = vi.fn().mockResolvedValue(new TextEncoder().encode('x: Imported'));
  d2.compile.mockRejectedValueOnce(Error('[{"range":"docs/__metis_d2_0.d2,0:0:0-0:4:4","errmsg":"failed to import \\\"docs/shared.d2\\\": file does not exist"}]'));
  const result = await renderD2Preview({ html: block('...@shared') + block('bad', '{"layout":"nope"}') + block(), theme: 'default', readD2File: read }, new AbortController().signal, async () => d2 as unknown as D2);
  expect(read).toHaveBeenCalledWith('docs/shared.d2');
  expect(d2.compile.mock.calls[1][0].fs['docs/shared.d2']).toBe('x: Imported');
  expect(result.assets.size).toBe(2); expect(result.diagnostics).toHaveLength(1);
  expect(result.html).toContain('<code>bad</code>'); expect(d2.dispose).toHaveBeenCalledOnce();
});

test('maps parser locations to the original source and to imported D2 files', () => {
  expect(d2Diagnostic(Error('[{"range":"docs/__metis_d2_0.d2,2:0:0-2:1:1","errmsg":"bad"}]'), 'docs/main.adoc', 8, 'docs/__metis_d2_0.d2')).toMatchObject({ relativePath: 'docs/main.adoc', line: 10 });
  expect(d2Diagnostic(Error('[{"range":"parts/x.d2,3:0:0-3:1:1","errmsg":"bad"}]'), 'main.adoc', 8, 'index')).toMatchObject({ relativePath: 'parts/x.d2', line: 4 });
  expect(d2Diagnostic(Error('[{"range":"docs/__metis_d2_0.d2,2:0:0-2:1:1","errmsg":"docs/__metis_d2_0.d2:3:1: bad"}]'), 'docs/main.adoc', 8, 'docs/__metis_d2_0.d2').message).toBe('D2 렌더링 오류: docs/main.adoc:10:1: bad');
});

test('dark preview follows defaults while preserving themes supplied by imported configuration', async () => {
  const d2 = engine();
  await renderD2Preview({ html: block(), theme: 'dark' }, new AbortController().signal, async () => d2 as unknown as D2);
  expect(d2.render.mock.calls[0][1].themeID).toBe(200);
  d2.render.mockClear(); d2.compile.mockResolvedValue({ ...structuredClone(compiled), renderOptions: { themeID: 300 } });
  await renderD2Preview({ html: block(), theme: 'dark' }, new AbortController().signal, async () => d2 as unknown as D2);
  expect(d2.render.mock.calls[0][1].themeID).toBe(300);
});

test('cancellation disposes the worker and cancelled/no-D2 documents do not initialize it', async () => {
  const controller = new AbortController(), d2 = engine();
  d2.compile.mockImplementation(async () => { controller.abort(); throw Error('disposed'); });
  const factory = vi.fn(async () => d2 as unknown as D2);
  const result = await renderD2Preview({ html: block(), theme: 'default' }, controller.signal, factory);
  expect(result.assets.size).toBe(0); expect(result.diagnostics).toEqual([]); expect(d2.dispose).toHaveBeenCalled();
  factory.mockClear(); await renderD2Preview({ html: block(), theme: 'default' }, controller.signal, factory);
  await renderD2Preview({ html: '<p>hello</p>', theme: 'default' }, new AbortController().signal, factory);
  expect(factory).not.toHaveBeenCalled();
});

test('D2 is a default extension while explicit disabled and removed preferences persist', () => {
  const runtime = new ExtensionRuntime([d2Extension], { readModel: () => undefined, openView: () => {} });
  runtime.restore({}); expect(runtime.list()[0].state).toBe('enabled');
  runtime.restore({ d2: 'disabled' }); expect(runtime.list()[0].state).toBe('disabled');
  runtime.restore({ d2: 'removed' }); expect(runtime.list()[0].state).toBe('removed');
});

test('board links expand their destination; exported SVG restores web links and text spacing', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve"><a href="root.layers.detail"><text>Next</text></a><a href="https://d2lang.com"><text> web</text></a></svg>';
  const asset = { kind: 'd2' as const, boards: [{ name: 'root', svg }, { name: 'layers.detail', svg }] };
  const template = document.createElement('template'); template.innerHTML = '<div data-preview-asset="d2-0"></div>';
  mountPreviewAssets(template.content, new Map([['d2-0', asset]]));
  const detail = template.content.querySelector<HTMLDetailsElement>('details[data-d2-board="layers.detail"]')!;
  detail.scrollIntoView = vi.fn(); expect(detail.open).toBe(false);
  followD2BoardLink(template.content.querySelector('a[data-d2-board-link]')!); expect(detail.open).toBe(true);
  const output = d2ExportData(asset, 0, 'svg');
  expect(output.frames[0]).toContain('href="https://d2lang.com"'); expect(output.frames[0]).toContain('xml:space="preserve"');
});

test('custom fonts cross the WASM JSON boundary as base64 instead of typed-array objects', async () => {
  const d2 = engine(), read = vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3]));
  await renderD2Preview({ html: block('a -> b', '{"font-regular":"font.ttf"}'), theme: 'default', readD2File: read }, new AbortController().signal, async () => d2 as unknown as D2);
  expect(read).toHaveBeenCalledWith('docs/font.ttf');
  expect(d2.compile.mock.calls[0][0].options.fontRegular).toBe('AAECAw==');
});

test('D2 SVG preserves images, links, embedded fonts and animations while removing active content', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><style>@import 'https://evil.test/x'; @font-face{font-family:x;src:url(data:font/woff;base64,AAAA)} @keyframes dash{to{stroke-dashoffset:10}}.a{animation:dash 1s infinite;fill:url(https://evil.test/x)}</style><image href="https://icons.d2lang.com/a.svg"/><a href="https://d2lang.com"><text>link</text></a><a href="javascript:bad()">bad</a><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><strong>Markdown</strong><script>bad()</script></div></foreignObject><set attributeName="href" to="javascript:bad()"/></svg>`;
  const clean = safeD2Svg(svg);
  expect(clean).toContain('https://icons.d2lang.com/a.svg'); expect(clean).toContain('data-web-url="https://d2lang.com"');
  expect(clean).toContain('data:font/woff;base64,AAAA'); expect(clean).toContain('@keyframes'); expect(clean).toContain('Markdown');
  expect(clean).not.toMatch(/<script|onload|javascript:|<set|evil\.test/);
  expect(safeD2Svg('<svg><unclosed>')).toBe('');
  const page = safePreview('<section><div data-preview-asset="d2-0"></div><a data-d2-export="pdf">forged</a></section>', undefined, new Map([['d2-0', { kind: 'd2', boards: [{ name: 'root', svg }] }]]));
  expect(page).toContain("script-src 'none'"); expect(page).toContain('aria-label="다이어그램 다운로드"'); expect(page).toContain('role="menuitem"'); expect(page).not.toContain('<a data-d2-export');
});

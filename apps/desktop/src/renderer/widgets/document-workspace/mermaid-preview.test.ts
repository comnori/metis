// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
import { DiagramCache } from '../../features/extensions/diagram-cache';
import type { MermaidCacheEntry } from '../../features/extensions/mermaid';

const { render, initialize } = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize, render } }));

beforeEach(() => { render.mockReset(); initialize.mockReset(); });

test('renders mermaid into a separately sanitized SVG slot', async () => {
  render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)"><foreignObject>bad</foreignObject><a href="https://example.com"><text>Link</text></a><text><tspan>문서 해석</tspan></text><rect id="safe" width="10" height="10"/></svg>' });
  const { renderMermaidPreview } = await import('../../features/extensions/mermaid');
  const result = await renderMermaidPreview('<div class="metis-mermaid" data-mermaid-path="main.adoc" data-mermaid-line="7"><pre><code>flowchart LR\nA--&gt;B</code></pre></div>', 'default');
  expect(result.diagnostics).toEqual([]);
  expect(result.html).toContain('data-preview-asset="diagram-0"');
  const svg = result.diagrams.get('diagram-0') ?? '';
  expect(svg).toContain('id="metis-mermaid-0-0"');
  expect(svg).not.toContain('foreignObject');
  expect(svg).not.toContain('onclick');
  expect(svg).not.toContain('https://example.com');
  expect(svg).toContain('문서 해석');
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ htmlLabels: false, secure: expect.arrayContaining(['htmlLabels', 'securityLevel']) }));
});

test('unchanged Mermaid diagrams survive body edits, line shifts, insertion and reordering without rendering again', async () => {
  const { renderMermaidPreview } = await import('../../features/extensions/mermaid');
  const cache = new DiagramCache<MermaidCacheEntry>();
  render.mockImplementation(async (id: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/></svg>` }));
  const block = (source: string, line = 1) => `<div class="metis-mermaid" data-mermaid-path="note.adoc" data-mermaid-line="${line}"><pre><code>${source}</code></pre></div>`;
  await renderMermaidPreview(block('A') + block('B'), 'default', undefined, cache);
  expect(render).toHaveBeenCalledTimes(2);
  const reordered = await renderMermaidPreview('<p>Edited prose</p>' + block('B', 20) + block('A', 30) + block('A', 40), 'default', undefined, cache);
  expect(render).toHaveBeenCalledTimes(2); expect(initialize).toHaveBeenCalledTimes(1);
  const ids = [...reordered.diagrams.values()].flatMap(svg => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('[id]')].map(e => e.id));
  expect(new Set(ids).size).toBe(ids.length);
  await renderMermaidPreview(block('A changed') + block('B'), 'default', undefined, cache);
  expect(render).toHaveBeenCalledTimes(3);
  await renderMermaidPreview(block('B'), 'dark', undefined, cache);
  expect(render).toHaveBeenCalledTimes(4);
});

test('cached Mermaid errors use the current source location and cancelled work is not cached', async () => {
  const { renderMermaidPreview } = await import('../../features/extensions/mermaid');
  const cache = new DiagramCache<MermaidCacheEntry>();
  const block = (line: number) => `<div class="metis-mermaid" data-mermaid-path="note.adoc" data-mermaid-line="${line}"><pre><code>bad</code></pre></div>`;
  render.mockRejectedValue(Error('Parse failure'));
  await renderMermaidPreview(block(5), 'default', undefined, cache);
  const result = await renderMermaidPreview(block(50), 'default', undefined, cache);
  expect(render).toHaveBeenCalledTimes(1); expect(result.diagnostics[0].line).toBe(50);
  cache.clear();
  const controller = new AbortController();
  render.mockImplementationOnce(async () => { controller.abort(); return { svg: '<svg/>' }; });
  await renderMermaidPreview(block(5), 'default', controller.signal, cache);
  render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  await renderMermaidPreview(block(5), 'default', undefined, cache);
  expect(render).toHaveBeenCalledTimes(3);
});

test('keeps source and reports its location when mermaid rendering fails', async () => {
  const { describeMermaidFailure } = await import('../../features/extensions/mermaid');
  document.body.innerHTML = '<div class="metis-mermaid" data-mermaid-path="included.adoc" data-mermaid-line="12"><pre><code>broken</code></pre></div>';
  const block = document.querySelector<HTMLElement>('.metis-mermaid')!;
  const diagnostic = describeMermaidFailure(block, new Error('Parse error\nline two'));
  expect(block.innerHTML).toContain('<code>broken</code>');
  expect(block.innerHTML).toContain('Mermaid 렌더링 오류');
  expect(diagnostic).toEqual({ relativePath: 'included.adoc', line: 12, message: 'Mermaid 렌더링 오류: Parse error' });
});

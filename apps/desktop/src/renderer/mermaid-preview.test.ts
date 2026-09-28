// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';

const render = vi.fn();
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render } }));

beforeEach(() => render.mockReset());

test('renders mermaid into a separately sanitized SVG slot', async () => {
  render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)"><foreignObject>bad</foreignObject><a href="https://example.com"><text>Link</text></a><rect id="safe" width="10" height="10"/></svg>' });
  const { renderMermaidPreview } = await import('./mermaid-preview');
  const result = await renderMermaidPreview('<div class="metis-mermaid" data-mermaid-path="main.adoc" data-mermaid-line="7"><pre><code>flowchart LR\nA--&gt;B</code></pre></div>', 'default');
  expect(result.diagnostics).toEqual([]);
  expect(result.html).toContain('data-mermaid-svg="diagram-0"');
  const svg = result.diagrams.get('diagram-0') ?? '';
  expect(svg).toContain('id="safe"');
  expect(svg).not.toContain('foreignObject');
  expect(svg).not.toContain('onclick');
  expect(svg).not.toContain('https://example.com');
});

test('keeps source and reports its location when mermaid rendering fails', async () => {
  const { describeMermaidFailure } = await import('./mermaid-preview');
  document.body.innerHTML = '<div class="metis-mermaid" data-mermaid-path="included.adoc" data-mermaid-line="12"><pre><code>broken</code></pre></div>';
  const block = document.querySelector<HTMLElement>('.metis-mermaid')!;
  const diagnostic = describeMermaidFailure(block, new Error('Parse error\nline two'));
  expect(block.innerHTML).toContain('<code>broken</code>');
  expect(block.innerHTML).toContain('Mermaid 렌더링 오류');
  expect(diagnostic).toEqual({ relativePath: 'included.adoc', line: 12, message: 'Mermaid 렌더링 오류: Parse error' });
});

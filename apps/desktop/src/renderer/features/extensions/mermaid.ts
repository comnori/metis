import type { ExtensionDefinition } from '@metis/contracts';
import { safeSvg } from '../../shared/lib/preview-svg';
import type { Diagnostic } from '@metis/contracts';
import type { PreviewTheme } from '../../shared/model/appearance';

export interface MermaidPreviewResult {
  html: string;
  diagrams: Map<string, string>;
  diagnostics: Diagnostic[];
}

export function describeMermaidFailure(block: HTMLElement, error: unknown): Diagnostic {
  const relativePath = block.dataset.mermaidPath ?? '';
  const line = Math.max(1, Number(block.dataset.mermaidLine) || 1);
  const message = error instanceof Error ? error.message.split('\n')[0] : '알 수 없는 Mermaid 오류';
  block.classList.add('metis-mermaid-error');
  const notice = block.ownerDocument.createElement('p'); notice.textContent = `Mermaid 렌더링 오류: ${message}`;
  block.querySelector('pre')?.before(notice);
  return { relativePath, line, message: `Mermaid 렌더링 오류: ${message}` };
}

let renderQueue: Promise<unknown> = Promise.resolve();
export function renderMermaidPreview(html: string, theme: PreviewTheme, signal?: AbortSignal): Promise<MermaidPreviewResult> {
  const pending = renderQueue.then(() => renderDiagramBlocks(html, theme, signal));
  renderQueue = pending.catch(() => {});
  return pending;
}

async function renderDiagramBlocks(html: string, theme: PreviewTheme, signal?: AbortSignal): Promise<MermaidPreviewResult> {
  const template = window.document.createElement('template'); template.innerHTML = html;
  const document = template.content;
  const blocks = [...document.querySelectorAll<HTMLElement>('.metis-mermaid')];
  const diagrams = new Map<string, string>(), diagnostics: Diagnostic[] = [];
  if (!blocks.length || signal?.aborted) return { html, diagrams, diagnostics };
  const { default: mermaid } = await import('mermaid');
  if (signal?.aborted) return { html, diagrams, diagnostics };
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : theme === 'sepia' ? 'base' : 'default',
    // Mermaid 12 renderers read the global option; flowchart-only configuration
    // can still emit foreignObject labels which safeSvg deliberately removes.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
    deterministicIds: true,
    deterministicIDSeed: 'metis-preview'
  });
  for (const [index, block] of blocks.entries()) {
    if (signal?.aborted) break;
    const source = block.querySelector('pre code')?.textContent ?? '';
    try {
      const rendered = await mermaid.render(`metis-mermaid-${index}`, source);
      const token = `diagram-${index}`;
      diagrams.set(token, safeSvg(rendered.svg));
      block.querySelector('pre')?.remove();
      const target = window.document.createElement('div');
      target.className = 'metis-mermaid-output'; target.dataset.previewAsset = token;
      block.append(target);
    } catch (error) {
      document.querySelector('#dmermaid-metis-mermaid-' + index)?.remove();
      diagnostics.push(describeMermaidFailure(block, error));
    }
  }
  return { html: template.innerHTML, diagrams, diagnostics };
}

export const mermaidExtension: ExtensionDefinition = {
  id: 'mermaid', name: 'Mermaid 다이어그램', defaultEnabled: true,
  description: '[mermaid] 블록을 다이어그램으로 표시합니다. 비활성화하면 원문 코드를 표시합니다.',
  activate(api) {
    api.preview('diagrams', async ({ html, theme }, signal) => {
      const result = await renderMermaidPreview(html, theme, signal);
      return { html: result.html, diagnostics: result.diagnostics, assets: new Map([...result.diagrams].map(([key, svg]) => [key, { kind: 'svg' as const, svg }])) };
    });
  }
};

import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
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

function safeSvg(svg: string): string {
  const source = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const blockedTags = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image']);
  for (const element of [...source.querySelectorAll('*')]) {
    if (blockedTags.has(element.tagName.toLowerCase())) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || /^(?:javascript|https?|file|data):/i.test(value)
        || (name === 'style' && /url\((?!\s*['"]?#)/i.test(value))) element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  const manuallyCleaned = new XMLSerializer().serializeToString(source.documentElement);
  const clean = DOMPurify.sanitize(manuallyCleaned, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror', 'onmouseover', 'onfocus']
  });
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName.toLowerCase() !== 'svg') return manuallyCleaned;
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || /^(?:javascript|https?|file|data):/i.test(value)
        || (name === 'style' && /url\((?!\s*['"]?#)/i.test(value))) element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  for (const style of document.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '').replaceAll(/@import\s+[^;]+;/gi, '').replaceAll(/url\((?!\s*['"]?#)[^)]+\)/gi, 'none');
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export async function renderMermaidPreview(html: string, theme: PreviewTheme): Promise<MermaidPreviewResult> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...document.querySelectorAll<HTMLElement>('.metis-mermaid')];
  const diagrams = new Map<string, string>(), diagnostics: Diagnostic[] = [];
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : theme === 'sepia' ? 'base' : 'default',
    flowchart: { htmlLabels: false },
    deterministicIds: true,
    deterministicIDSeed: 'metis-preview'
  });
  for (const [index, block] of blocks.entries()) {
    const source = block.querySelector('pre code')?.textContent ?? '';
    try {
      const rendered = await mermaid.render(`metis-mermaid-${index}`, source);
      const token = `diagram-${index}`;
      diagrams.set(token, safeSvg(rendered.svg));
      block.querySelector('pre')?.remove();
      const target = document.createElement('div');
      target.className = 'metis-mermaid-output'; target.dataset.mermaidSvg = token;
      block.append(target);
    } catch (error) {
      document.querySelector('#dmermaid-metis-mermaid-' + index)?.remove();
      diagnostics.push(describeMermaidFailure(block, error));
    }
  }
  return { html: document.body.innerHTML, diagrams, diagnostics };
}

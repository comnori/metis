import type { Analysis } from '@metis/contracts';

export function previewElementAtLine(doc: Document, analysis: Analysis, path: string, line: number): Element | undefined {
  const locations = (analysis.previewLocations ?? []).filter(location => location.relativePath === path && location.line <= line);
  const candidates: { line: number; element: Element }[] = [];
  const elements = new Map<string, Element | undefined>();
  for (const element of doc.querySelectorAll('[data-metis-source]')) {
    const token = element.getAttribute('data-metis-source')!;
    elements.set(token, elements.has(token) ? undefined : element);
  }
  for (const location of locations) {
    const element = elements.get(location.token);
    // Section wrappers include heading margins; use the same target as outline navigation.
    const heading = element?.firstElementChild;
    if (element) candidates.push({ line: location.line, element: heading && /^H[1-6]$/.test(heading.tagName) ? heading : element });
  }
  for (const kind of ['d2', 'mermaid']) for (const element of doc.querySelectorAll(`[data-${kind}-path][data-${kind}-line]`)) {
    const sourceLine = Number(element.getAttribute(`data-${kind}-line`));
    if (element.getAttribute(`data-${kind}-path`) === path && Number.isInteger(sourceLine) && sourceLine > 0 && sourceLine <= line) candidates.push({ line: sourceLine, element });
  }
  if (candidates.length) return candidates.sort((a, b) => b.line - a.line)[0].element;
  const entries = analysis.outline.filter(entry => entry.relativePath === path && entry.line <= line).sort((a, b) => b.line - a.line);
  for (const entry of entries) {
    const matches = [...doc.querySelectorAll('[id]')].filter(element => element.id === entry.id);
    if (entry.id && matches.length === 1) return matches[0];
  }
}

export function alignPreviewToLine(doc: Document, analysis: Analysis, path: string, line: number) {
  const element = previewElementAtLine(doc, analysis, path, line);
  if (element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.localName === 'details') (parent as HTMLDetailsElement).open = true;
    element.scrollIntoView({ block: 'start' });
  } else doc.defaultView?.scrollTo(0, 0);
}

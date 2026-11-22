// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { DiagramFullscreen, fullscreenDiagram } from './diagram-fullscreen';

test('fullscreen snapshots retain D2 labels, fonts and theme without copying inline zoom or changing the original', () => {
  const source = new DOMParser().parseFromString('<html><head><style>body{background:#123;color:white}</style><style data-metis-diagram-navigation>temporary controls</style></head><body><div class="metis-d2-diagram"></div></body></html>', 'text/html');
  // happy-dom's HTML parser cannot parse <style> inside SVG; use its XML parser.
  const rendered = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 200" style="transform:translate(20px, 30px) scale(2);transform-origin:center center"><style>@font-face{font-family:x;src:url(data:font/woff;base64,AAAA)}</style><foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml">D2 label</div></foreignObject><image href="data:image/png;base64,AAAA"/></svg>', 'image/svg+xml');
  source.querySelector('div')!.append(source.importNode(rendered.documentElement, true));
  const original = source.querySelector<SVGSVGElement>('svg')!, before = original.outerHTML;
  const snapshot = fullscreenDiagram(original), result = new DOMParser().parseFromString(snapshot.html, 'text/html');
  expect(snapshot.title).toBe('D2 다이어그램 전체 화면'); expect(snapshot.invoker).toBe(original.parentElement);
  expect(result.querySelector('svg')?.style.transform).toBe(''); expect(result.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  expect(snapshot.html).toContain('D2 label');
  expect(snapshot.html).toContain('<foreignObject'); expect(snapshot.html).toContain('data:font/woff;base64,AAAA');
  expect(snapshot.html).toContain('data:image/png;base64,AAAA'); expect(snapshot.html).toContain('background:#123');
  expect(snapshot.html).not.toContain('temporary controls'); expect(snapshot.html).toContain("script-src 'none'");
  expect(original.outerHTML).toBe(before);
});

test('fullscreen closes with Escape from its frame or header and cleans up interaction handlers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), close = vi.fn();
  const source = new DOMParser().parseFromString('<div class="metis-mermaid-output"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Mermaid</text></svg></div>', 'text/html');
  try {
    await act(async () => root.render(React.createElement(DiagramFullscreen, { diagram: fullscreenDiagram(source.querySelector('svg')!), close })));
    const frame = host.querySelector('iframe')!, doc = frame.contentDocument!;
    doc.body.innerHTML = '<div class="metis-mermaid-output"><svg viewBox="0 0 200 100"><text>Mermaid</text></svg></div>';
    await act(async () => frame.dispatchEvent(new Event('load')));
    doc.querySelector<HTMLButtonElement>('button[aria-label="다이어그램 확대"]')!.click();
    expect(doc.querySelector('svg')?.style.transform).toContain('scale(1.25)');
    doc.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(close).toHaveBeenCalledOnce();
    await act(async () => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); expect(close).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(close).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

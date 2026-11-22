import React, { useEffect, useRef } from 'react';
import { DialogShell } from '../../shared/ui/dialog-shell';
import { installDiagramNavigation } from '../../shared/lib/diagram-navigation';
import './diagram-fullscreen.css';

export interface FullscreenDiagram { title: string; html: string; invoker: HTMLElement }

/** Reuse the rendered, sanitized SVG inside another script-free frame. */
export function fullscreenDiagram(svg: SVGSVGElement): FullscreenDiagram {
  const source = svg.ownerDocument, doc = source.implementation.createHTMLDocument();
  const title = `${svg.closest('.metis-d2-diagram') ? 'D2' : 'Mermaid'} 다이어그램 전체 화면`;
  doc.title = title; doc.documentElement.lang = 'ko';
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https: metis-attachment:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  for (const style of source.head.querySelectorAll('style:not([data-metis-diagram-navigation])')) doc.head.append(doc.importNode(style, true));
  const output = doc.createElement('div'); output.className = svg.closest('.metis-d2-diagram') ? 'metis-d2-diagram' : 'metis-mermaid-output';
  const clone = doc.importNode(svg, true);
  clone.style.removeProperty('transform'); clone.style.removeProperty('transform-origin');
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  output.append(clone); doc.body.append(output);
  const layout = doc.createElement('style');
  layout.textContent = `html,body{box-sizing:border-box;width:100%!important;height:100%!important;min-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important}
    body{display:flex!important;flex-direction:column!important}
    body>.metis-diagram-viewport{flex:1!important;width:100%!important;height:0!important;min-height:0!important;min-width:0!important;margin:0!important;padding:16px!important;box-sizing:border-box}
    body>.metis-diagram-viewport>svg{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;margin:0!important}
    body>.metis-diagram-tools{flex:none;margin:0!important;padding:10px 16px!important;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)}
    body>.metis-diagram-hint{flex:none;margin:0!important;padding:6px 16px!important}`;
  doc.head.append(layout);
  return { title, html: '<!doctype html>' + doc.documentElement.outerHTML, invoker: svg.parentElement! };
}

export function DiagramFullscreen({ diagram, close }: { diagram: FullscreenDiagram; close(): void }) {
  const dispose = useRef(() => {}), dismiss = useRef(close); dismiss.current = close;
  useEffect(() => () => dispose.current(), []);
  const loaded = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    dispose.current();
    const doc = event.currentTarget.contentDocument; if (!doc) return;
    const removeNavigation = installDiagramNavigation(doc, new Map(), { fullscreen: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation(); dismiss.current();
    };
    // Keyboard events inside an iframe do not bubble to the parent dialog.
    doc.addEventListener('keydown', escape, true);
    const preventNavigation = (event: MouseEvent) => { if ((event.target as Element).closest('a')) event.preventDefault(); };
    doc.addEventListener('click', preventNavigation);
    doc.querySelector<HTMLElement>('.metis-diagram-viewport')?.focus({ preventScroll: true });
    dispose.current = () => { removeNavigation(); doc.removeEventListener('keydown', escape, true); doc.removeEventListener('click', preventNavigation); };
  };
  return <DialogShell title={diagram.title} className="diagram-fullscreen" description="휠 또는 +/−로 확대·축소 · 드래그로 이동 · Esc로 닫기" close={close} actions={<></>}>
    <iframe title={diagram.title} sandbox="allow-same-origin" srcDoc={diagram.html} onLoad={loaded} />
  </DialogShell>;
}

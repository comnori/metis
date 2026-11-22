export interface DiagramView { scale: number; x: number; y: number }
export type DiagramViews = Map<string, DiagramView>;
export interface DiagramNavigationOptions {
  fullscreen?: boolean;
  onFullscreen?(svg: SVGSVGElement): void;
}

const minScale = .25, maxScale = 8;
export const diagramNavigationStyles = `
.metis-diagram-viewport{position:relative;display:grid;place-items:center;min-height:160px;overflow:hidden!important;cursor:grab;touch-action:none;user-select:none}
.metis-diagram-viewport[data-dragging]{cursor:grabbing}
.metis-diagram-viewport:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
.metis-diagram-tools{display:flex;align-items:center;gap:4px;min-height:36px;margin:0 0 4px;font:13px/1.4 system-ui,sans-serif;text-align:left}
.metis-diagram-tools button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:6px;min-width:30px;min-height:30px;padding:3px 7px}
.metis-diagram-tools button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.metis-diagram-tools button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.metis-diagram-tools button:disabled{opacity:.4;cursor:default}.metis-diagram-tools output{min-width:42px;text-align:center;font-variant-numeric:tabular-nums}
.metis-diagram-hint{font:11px/1.4 system-ui,sans-serif;opacity:.7;text-align:left;margin:4px 0 8px}
.metis-d2-canvas>.metis-diagram-tools{position:absolute;top:4px;left:4px;right:48px;margin:0}
@media print{.metis-diagram-tools,.metis-diagram-hint{display:none!important}.metis-diagram-viewport{overflow:visible!important}.metis-diagram-viewport>svg{transform:none!important}}
`;

// A small fingerprint avoids retaining a second copy of large SVGs in view-state keys.
function viewKey(svg: SVGSVGElement, index: number): string {
  const source = svg.outerHTML;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${index}:${source.length}:${hash >>> 0}`;
}

/** Controls are installed by the host after load; exported SVG/PDF snapshots stay untransformed. */
export function installDiagramNavigation(doc: Document, views: DiagramViews = new Map(), options: DiagramNavigationOptions = {}): () => void {
  const cleanups: Array<() => void> = [];
  const style = doc.createElement('style'); style.dataset.metisDiagramNavigation = ''; style.textContent = diagramNavigationStyles; doc.head.append(style);
  for (const [index, svg] of [...doc.querySelectorAll<SVGSVGElement>('.metis-mermaid-output>svg,.metis-d2-diagram>svg')].entries()) {
    const viewport = svg.parentElement!;
    const key = viewKey(svg, index), view = { ...(views.get(key) ?? { scale: 1, x: 0, y: 0 }) };
    const oldTransform = svg.style.transform, oldOrigin = svg.style.transformOrigin;
    const toolbar = doc.createElement('div'); toolbar.className = 'metis-diagram-tools'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', '다이어그램 보기 조절');
    const hint = doc.createElement('p'); hint.className = 'metis-diagram-hint'; hint.id = `metis-diagram-hint-${index}`;
    hint.textContent = options.fullscreen ? '드래그·방향키로 이동 · 휠로 확대/축소 · Esc로 닫기' : `드래그로 이동 · Ctrl/⌘+휠로 확대/축소${options.onFullscreen ? ' · 더블클릭으로 전체 화면' : ' · 방향키로 이동'}`;
    const button = (label: string, text: string, action: () => void) => {
      const control = doc.createElement('button'); control.type = 'button'; control.setAttribute('aria-label', label); control.title = label; control.textContent = text;
      control.addEventListener('click', action); toolbar.append(control); return control;
    };
    const minus = button('다이어그램 축소', '−', () => zoom(view.scale / 1.25));
    const percent = doc.createElement('output'); percent.setAttribute('aria-label', '다이어그램 배율'); toolbar.append(percent);
    const plus = button('다이어그램 확대', '+', () => zoom(view.scale * 1.25));
    button('다이어그램 화면에 맞춤', '맞춤', () => { Object.assign(view, { scale: 1, x: 0, y: 0 }); apply(); });
    if (options.onFullscreen) button('다이어그램 전체 화면', '⛶', () => options.onFullscreen!(svg));
    viewport.before(toolbar); viewport.after(hint);
    viewport.classList.add('metis-diagram-viewport'); viewport.tabIndex = 0;
    viewport.setAttribute('role', 'group'); viewport.setAttribute('aria-label', '다이어그램 이동 영역'); viewport.setAttribute('aria-describedby', hint.id);
    function apply() {
      svg.style.transformOrigin = 'center center';
      svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      percent.textContent = `${Math.round(view.scale * 100)}%`;
      minus.disabled = view.scale <= minScale; plus.disabled = view.scale >= maxScale;
      views.delete(key); views.set(key, { ...view });
      while (views.size > 200) views.delete(views.keys().next().value!);
    }
    function zoom(scale: number, anchorX = 0, anchorY = 0) {
      const next = Math.max(minScale, Math.min(maxScale, scale)), factor = next / view.scale;
      view.x = anchorX - (anchorX - view.x) * factor; view.y = anchorY - (anchorY - view.y) * factor;
      view.scale = next; apply();
    }
    const wheel = (event: WheelEvent) => {
      if (!options.fullscreen && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(view.scale * Math.exp(-Math.max(-250, Math.min(250, delta)) * .002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    let drag: { id: number; x: number; y: number; startX: number; startY: number } | undefined, dragged = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button,input,textarea,select')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y }; dragged = false;
      event.preventDefault(); viewport.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) < 3) return;
      if (!dragged) { viewport.setPointerCapture?.(event.pointerId); dragged = true; viewport.dataset.dragging = ''; }
      event.preventDefault(); view.x = drag.startX + dx; view.y = drag.startY + dy; apply();
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      drag = undefined; delete viewport.dataset.dragging;
      if (event.type === 'pointercancel') dragged = false;
    };
    let linkTimer: ReturnType<typeof setTimeout> | undefined, replayingLink = false;
    const cancelLink = () => { clearTimeout(linkTimer); linkTimer = undefined; };
    const click = (event: MouseEvent) => {
      if (dragged) { event.preventDefault(); event.stopImmediatePropagation(); dragged = false; cancelLink(); return; }
      // Give a double-click on a linked D2 shape time to open the viewer before navigating.
      const link = (event.target as Element).closest('a');
      if (!options.onFullscreen || !link || replayingLink || event.detail === 0) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancelLink();
      if (event.detail > 1) return;
      linkTimer = setTimeout(() => {
        linkTimer = undefined;
        if (!link.isConnected) return;
        replayingLink = true;
        try { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })); }
        finally { replayingLink = false; }
      }, 500);
    };
    const fullscreen = (event: MouseEvent) => {
      if (!options.onFullscreen || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); cancelLink(); dragged = false; options.onFullscreen(svg);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.shiftKey ? 80 : 30;
      if (event.key === 'Enter' && options.onFullscreen) options.onFullscreen(svg);
      else if (event.key === '+' || event.key === '=') zoom(view.scale * 1.25);
      else if (event.key === '-') zoom(view.scale / 1.25);
      else if (event.key === '0' || event.key === 'Home') { Object.assign(view, { scale: 1, x: 0, y: 0 }); apply(); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        view.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        view.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; apply();
      } else return;
      event.preventDefault(); event.stopPropagation();
    };
    viewport.addEventListener('wheel', wheel, { passive: false }); viewport.addEventListener('pointerdown', down);
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
    viewport.addEventListener('lostpointercapture', up); viewport.addEventListener('click', click, true); viewport.addEventListener('keydown', keydown);
    viewport.addEventListener('dblclick', fullscreen);
    apply();
    cleanups.push(() => {
      cancelLink();
      if (drag && viewport.hasPointerCapture?.(drag.id)) viewport.releasePointerCapture(drag.id);
      viewport.removeEventListener('wheel', wheel); viewport.removeEventListener('pointerdown', down);
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up);
      viewport.removeEventListener('lostpointercapture', up); viewport.removeEventListener('click', click, true); viewport.removeEventListener('keydown', keydown);
      viewport.removeEventListener('dblclick', fullscreen);
      viewport.classList.remove('metis-diagram-viewport');
      for (const attr of ['tabindex', 'role', 'aria-label', 'aria-describedby', 'data-dragging']) viewport.removeAttribute(attr);
      svg.style.transform = oldTransform; svg.style.transformOrigin = oldOrigin; toolbar.remove(); hint.remove();
    });
  }
  return () => { for (const cleanup of cleanups) cleanup(); style.remove(); };
}

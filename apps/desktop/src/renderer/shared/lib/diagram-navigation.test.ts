// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { installDiagramNavigation, type DiagramViews } from './diagram-navigation';

let cleanup = () => {};
const fixture = () => {
  document.body.innerHTML = '<div class="metis-mermaid-output"><svg xmlns="http://www.w3.org/2000/svg"><text>Mermaid</text></svg></div><div class="metis-d2-canvas"><div class="metis-d2-diagram"><svg xmlns="http://www.w3.org/2000/svg"><a href="#target"><text>D2</text></a></svg></div></div>';
};
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const viewport = () => document.querySelector<HTMLElement>('.metis-diagram-viewport')!;
const svg = () => viewport().querySelector('svg')!;
const control = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

test('diagrams zoom independently with bounded scale, keyboard panning and fit reset', () => {
  fixture(); cleanup = installDiagramNavigation(document);
  control('다이어그램 확대').click();
  expect(svg().style.transform).toContain('scale(1.25)');
  expect(document.querySelector('.metis-d2-diagram>svg')?.getAttribute('style')).toContain('scale(1)');
  for (let i = 0; i < 30; i++) control('다이어그램 확대').click();
  expect(control('다이어그램 확대').disabled).toBe(true); expect(svg().style.transform).toContain('scale(8)');
  viewport().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(svg().style.transform).toContain('translate(30px, 0px)');
  control('다이어그램 화면에 맞춤').click(); expect(svg().style.transform).toBe('translate(0px, 0px) scale(1)');
  for (let i = 0; i < 30; i++) control('다이어그램 축소').click();
  expect(control('다이어그램 축소').disabled).toBe(true); expect(svg().style.transform).toContain('scale(0.25)');
});

test('ordinary wheel scrolls the document while Ctrl+wheel zooms around the pointer', () => {
  fixture(); cleanup = installDiagramNavigation(document);
  vi.spyOn(viewport(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }); viewport().dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false); expect(svg().style.transform).toContain('scale(1)');
  const zoom = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  // happy-dom's WheelEvent does not inherit MouseEvent modifier/coordinate fields.
  Object.defineProperties(zoom, { ctrlKey: { value: true }, clientX: { value: 300 }, clientY: { value: 100 } }); viewport().dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(true);
  expect(svg().style.transform).toContain(`translate(${100 - 100 * Math.exp(.2)}px, 0px)`);
});

test('dragging pans without activating links, and cleanup removes handlers', () => {
  fixture(); cleanup = installDiagramNavigation(document);
  const area = document.querySelector<HTMLElement>('.metis-d2-diagram')!, link = area.querySelector('a')!;
  area.setPointerCapture = vi.fn();
  const follow = vi.fn(); document.addEventListener('click', follow);
  const pointer = (name: string, x: number, y: number) => new PointerEvent(name, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
  link.dispatchEvent(pointer('pointerdown', 10, 20)); document.dispatchEvent(pointer('pointerup', 10, 20));
  link.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(follow).toHaveBeenCalledTimes(1);
  link.dispatchEvent(pointer('pointerdown', 10, 20)); document.dispatchEvent(pointer('pointermove', 70, 50)); document.dispatchEvent(pointer('pointerup', 70, 50));
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(follow).toHaveBeenCalledTimes(1); expect(area.querySelector('svg')?.style.transform).toBe('translate(60px, 30px) scale(1)');
  document.removeEventListener('click', follow);
  cleanup(); cleanup = () => {};
  expect(document.querySelector('.metis-diagram-tools')).toBeNull(); expect(area.querySelector('svg')?.style.transform).toBe('');
  area.dispatchEvent(pointer('pointerdown', 0, 0)); document.dispatchEvent(pointer('pointermove', 80, 80));
  expect(area.querySelector('svg')?.style.transform).toBe('');
});

test('unchanged SVGs retain their view on refresh while changed diagrams start fitted', () => {
  const views: DiagramViews = new Map(); fixture(); cleanup = installDiagramNavigation(document, views);
  control('다이어그램 확대').click(); cleanup();
  fixture(); cleanup = installDiagramNavigation(document, views); expect(svg().style.transform).toContain('scale(1.25)'); cleanup();
  fixture(); document.querySelector('.metis-mermaid-output text')!.textContent = 'Changed';
  cleanup = installDiagramNavigation(document, views); expect(svg().style.transform).toContain('scale(1)');
});

test('double-click, Enter and the fullscreen button open the selected rendered SVG', () => {
  fixture(); const open = vi.fn(); cleanup = installDiagramNavigation(document, new Map(), { onFullscreen: open });
  const selected = svg(); selected.dispatchEvent(new MouseEvent('dblclick', { button: 0, bubbles: true, cancelable: true }));
  expect(open).toHaveBeenLastCalledWith(selected);
  viewport().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  control('다이어그램 전체 화면').click(); expect(open).toHaveBeenCalledTimes(3);
  cleanup(); cleanup = () => {}; selected.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); expect(open).toHaveBeenCalledTimes(3);
});

test('fullscreen accepts ordinary wheel zoom without enabling nested fullscreen controls', () => {
  fixture(); cleanup = installDiagramNavigation(document, new Map(), { fullscreen: true });
  const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  Object.defineProperties(wheel, { clientX: { value: 0 }, clientY: { value: 0 } }); viewport().dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true); expect(svg().style.transform).toContain(`scale(${Math.exp(.2)})`);
  expect(control('다이어그램 전체 화면')).toBeNull();
});

test('double-clicking linked D2 shapes opens fullscreen without following their link', () => {
  vi.useFakeTimers();
  try {
    fixture(); const open = vi.fn(), follow = vi.fn(); cleanup = installDiagramNavigation(document, new Map(), { onFullscreen: open });
    const link = document.querySelector('a')!;
    document.addEventListener('click', follow);
    try {
      link.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(100);
      link.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true, cancelable: true }));
      link.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(600); expect(open).toHaveBeenCalledOnce(); expect(follow).not.toHaveBeenCalled();
      link.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(500); expect(follow).toHaveBeenCalledOnce();
    } finally { document.removeEventListener('click', follow); }
  } finally { vi.useRealTimers(); }
});

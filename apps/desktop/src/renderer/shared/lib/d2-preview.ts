import type { D2ExportFormat, D2ExportRequest, PreviewAsset } from '@metis/contracts';
import { safeD2Svg } from './d2-svg';

export const d2PreviewStyles = `
.metis-d2{margin:1.25em 0}.metis-d2>.title{font-weight:600;text-align:center}
.metis-d2-board{margin:.5em 0}.metis-d2-board>summary{display:flex;align-items:center;gap:.55em;cursor:pointer;font-size:.85em;padding:.55em .25em;list-style:none}
.metis-d2-board>summary::-webkit-details-marker{display:none}.metis-d2-board>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
.metis-d2-board[open]>summary::before{transform:rotate(45deg)}
.metis-d2-canvas{position:relative;padding-top:46px}.metis-d2-diagram{overflow:auto;text-align:center}
.metis-d2-diagram>svg{display:block;max-width:100%;max-height:70vh;width:auto;height:auto;margin:0 auto}.metis-d2-diagram pre{text-align:left}
.metis-d2-error{border-left:4px solid #b42318;padding:.75em}
.metis-d2-tools{position:absolute;top:4px;right:4px;z-index:2;font-family:system-ui,sans-serif}
.metis-d2-tools button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}
.metis-d2-download{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;padding:0!important;color:inherit}
.metis-d2-download:hover,.metis-d2-download[aria-expanded=true]{background:color-mix(in srgb,currentColor 9%,transparent)}
.metis-d2-tools button:focus-visible,.metis-d2-board>summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.metis-d2-menu{position:absolute;right:0;top:42px;min-width:190px;max-width:calc(100vw - 64px);padding:5px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 8px 28px #0002;z-index:3}
.metis-d2-menu[hidden]{display:none!important}.metis-d2-menu button{display:flex;justify-content:space-between;align-items:center;gap:20px;width:100%;padding:9px 10px;border-radius:6px;text-align:left;font-size:13px;line-height:1.4}
.metis-d2-menu button:hover,.metis-d2-menu button:focus{background:color-mix(in srgb,currentColor 9%,transparent)}.metis-d2-menu button>span{font-size:12px;opacity:.65}.metis-d2-tools button:disabled{opacity:.45;cursor:wait}
@media(prefers-reduced-motion:reduce){.metis-d2-board>summary::before{transition:none}}
@media print{.metis-d2-tools,.metis-d2-board>summary{display:none}.metis-d2-canvas{padding-top:0}.metis-d2-diagram>svg{max-height:none}}`;

export function d2BoardLabel(name: string): string {
  const [kind, ...path] = name.split('.');
  const prefix = ({ layers: '상세', scenarios: '시나리오', steps: '단계' } as Record<string, string>)[kind];
  return prefix ? `${prefix} · ${path.join(' / ')}` : name;
}

/** Host-side events keep the preview's script-free CSP intact. */
export function installD2DownloadMenus(doc: Document): () => void {
  const menuFor = (toggle: HTMLElement) => {
    const menu = doc.getElementById(toggle.getAttribute('aria-controls') ?? '');
    return menu?.matches('[data-d2-menu]') && menu.parentElement === toggle.parentElement ? menu : undefined;
  };
  const close = (restoreFocus = false) => {
    for (const toggle of doc.querySelectorAll<HTMLButtonElement>('[data-d2-menu-toggle][aria-expanded="true"]')) {
      toggle.setAttribute('aria-expanded', 'false');
      const menu = menuFor(toggle); if (menu) menu.hidden = true;
      if (restoreFocus) toggle.focus();
    }
  };
  const open = (toggle: HTMLButtonElement, last = false) => {
    const menu = menuFor(toggle); if (!menu) return;
    close(); menu.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
    items[last ? items.length - 1 : 0]?.focus();
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    const toggle = target.closest?.<HTMLButtonElement>('button[data-d2-menu-toggle]');
    if (toggle) { event.preventDefault(); if (toggle.getAttribute('aria-expanded') === 'true') close(true); else open(toggle); return; }
    if (target.closest?.('[data-d2-export]')) close(true);
    else if (!target.closest?.('[data-d2-menu]')) close();
  };
  const keydown = (event: KeyboardEvent) => {
    const target = event.target as Element;
    const toggle = target.closest?.<HTMLButtonElement>('button[data-d2-menu-toggle]');
    if (toggle && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(toggle, event.key === 'ArrowUp'); return; }
    const menu = target.closest?.<HTMLElement>('[data-d2-menu]');
    if (event.key === 'Escape' && doc.querySelector('[data-d2-menu-toggle][aria-expanded="true"]')) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!menu || menu.hidden) return;
    if (event.key === 'Tab') { close(true); return; }
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : undefined;
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
  };
  const focusout = (event: FocusEvent) => {
    const next = event.relatedTarget as Element | null;
    if (next && !next.closest?.('.metis-d2-tools')) close();
  };
  const toggleBoard = () => { const active = doc.activeElement as HTMLElement | null; if (active?.closest('details.metis-d2-board:not([open])')) close(); };
  doc.addEventListener('click', click); doc.addEventListener('keydown', keydown); doc.addEventListener('focusout', focusout); doc.addEventListener('toggle', toggleBoard, true);
  return () => { close(); doc.removeEventListener('click', click); doc.removeEventListener('keydown', keydown); doc.removeEventListener('focusout', focusout); doc.removeEventListener('toggle', toggleBoard, true); };
}

export function d2ExportData(asset: PreviewAsset, index: number, format: D2ExportFormat): Pick<D2ExportRequest, 'format' | 'name' | 'frames'> {
  if (asset.kind !== 'd2' || !asset.boards[index]) throw Error('D2 다이어그램을 찾을 수 없습니다.');
  const board = asset.boards[index];
  const svg = (value: string) => {
    const clean = safeD2Svg(value), doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
    // Saved SVGs retain ordinary browser links, without application-only metadata.
    for (const anchor of doc.querySelectorAll('[data-web-url]')) { anchor.setAttribute('href', anchor.getAttribute('data-web-url')!); anchor.removeAttribute('data-web-url'); }
    return new XMLSerializer().serializeToString(doc.documentElement);
  };
  return { format, name: `d2-${board.name.replaceAll(/[^\w.-]/g, '-').slice(0, 100)}`, frames: format === 'txt' ? [board.ascii ?? ''] : format === 'gif' ? asset.boards.filter(b => b.svg && b.name !== 'animation').map(b => svg(b.svg)) : [svg(board.svg)] };
}

export function followD2BoardLink(anchor: Element): void {
  const slot = anchor.closest('[data-preview-asset]');
  const link = anchor.getAttribute('data-d2-board-link')?.replace(/\.svg$/, '').replaceAll('/', '.').replace(/^root\./, '');
  const board = [...(slot?.querySelectorAll<HTMLElement>('[data-d2-board]') ?? [])].find(b => b.dataset.d2Board === link || link === 'root' && b.dataset.d2Board === 'root');
  if (board) { if (board.tagName === 'DETAILS') (board as HTMLDetailsElement).open = true; board.scrollIntoView({ block: 'nearest' }); }
}

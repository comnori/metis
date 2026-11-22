// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { mountPreviewAssets } from './preview-assets';
import { followD2BoardLink, installD2DownloadMenus } from './d2-preview';
import { safePreview } from '../../widgets/document-workspace/preview';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>주문 서비스</text></svg>';
let dispose = () => {};
afterEach(() => { dispose(); document.body.replaceChildren(); });

function mount(multiple = false) {
  const template = document.createElement('template');
  template.innerHTML = '<button id="outside">본문</button><div data-preview-asset="d2-0"></div><div data-preview-asset="d2-1"></div>';
  mountPreviewAssets(template.content, new Map([
    ['d2-0', { kind: 'd2', boards: [{ name: 'root', svg }, ...(multiple ? [{ name: 'layers.detail', svg }] : [])] }],
    ['d2-1', { kind: 'd2', boards: [{ name: 'root', svg }] }]
  ]));
  document.body.replaceChildren(template.content);
  dispose = installD2DownloadMenus(document);
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-d2-menu-toggle]')];
  const menus = [...document.querySelectorAll<HTMLElement>('[data-d2-menu]')];
  return { toggles, menus };
}

test('single/root boards have no disclosure header; download choices are hidden behind one icon', () => {
  const { toggles, menus } = mount();
  expect(document.querySelectorAll('details,summary')).toHaveLength(0);
  expect(toggles).toHaveLength(2);
  expect(new Set(menus.map(menu => menu.id)).size).toBe(2);
  expect(menus.every(menu => menu.hidden)).toBe(true);
  expect([...menus[0].querySelectorAll('button')].map(button => button.dataset.d2Export)).toEqual(['svg', 'png', 'pdf']);
  expect(document.body.textContent).not.toContain('SVG 저장');
  toggles[0].click();
  expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement?.getAttribute('data-d2-export')).toBe('svg');
  toggles[1].click();
  expect(menus[0].hidden).toBe(true); expect(menus[1].hidden).toBe(false);
  document.getElementById('outside')!.click();
  expect(menus[1].hidden).toBe(true);
});

test('keyboard navigation, escape, format selection and tab close the menu with usable focus', () => {
  const { toggles, menus } = mount();
  const key = (value: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  toggles[0].focus(); key('ArrowUp');
  expect(document.activeElement?.getAttribute('data-d2-export')).toBe('pdf');
  key('ArrowDown'); expect(document.activeElement?.getAttribute('data-d2-export')).toBe('svg');
  key('End'); expect(document.activeElement?.getAttribute('data-d2-export')).toBe('pdf');
  key('Home'); expect(document.activeElement?.getAttribute('data-d2-export')).toBe('svg');
  key('Escape'); expect(menus[0].hidden).toBe(true); expect(document.activeElement).toBe(toggles[0]);
  toggles[0].click(); (document.activeElement as HTMLButtonElement).click();
  expect(menus[0].hidden).toBe(true); expect(document.activeElement).toBe(toggles[0]);
  toggles[0].click(); key('Tab'); expect(menus[0].hidden).toBe(true);
  toggles[0].click(); document.getElementById('outside')!.focus(); expect(menus[0].hidden).toBe(true);
});

test('additional boards keep readable disclosure names and links still reveal their targets', () => {
  mount(true);
  const detail = document.querySelector<HTMLDetailsElement>('details[data-d2-board="layers.detail"]')!;
  expect(detail.querySelector('summary')?.textContent).toBe('상세 · detail');
  expect(detail.open).toBe(false);
  const root = document.querySelector<HTMLElement>('[data-d2-board="root"]')!;
  const anchor = document.createElement('a'); anchor.dataset.d2BoardLink = 'root.layers.detail'; root.append(anchor);
  detail.scrollIntoView = vi.fn(); followD2BoardLink(anchor); expect(detail.open).toBe(true);
  root.scrollIntoView = vi.fn(); anchor.dataset.d2BoardLink = 'root'; followD2BoardLink(anchor);
  expect(root.scrollIntoView).toHaveBeenCalledOnce(); expect(root.hasAttribute('open')).toBe(false);
});

test('preview source cannot forge menu controls or export metadata', () => {
  const output = safePreview('<div data-d2-menu-toggle data-d2-menu data-d2-export="pdf" data-d2-asset="d2-0" data-d2-index="0">forged</div>');
  const page = new DOMParser().parseFromString(output, 'text/html');
  expect(page.querySelector('[data-d2-menu-toggle],[data-d2-menu],[data-d2-export]')).toBeNull();
  expect(output).toContain("script-src 'none'");
});

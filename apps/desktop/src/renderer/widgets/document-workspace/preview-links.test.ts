// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { followPreviewFragment } from './preview-links';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function clickLink(anchor: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  const handler = (event: MouseEvent) => followPreviewFragment(event, document);
  document.addEventListener('click', handler, { once: true });
  anchor.dispatchEvent(event);
  return event;
}

test('TOC and nested link content scroll in place, reveal details and focus the destination', () => {
  document.body.innerHTML = '<a href="#section"><span>Section</span></a><details><summary>Example</summary><h2 id="section">Target</h2></details>';
  const heading = document.getElementById('section')!, scroll = vi.spyOn(heading, 'scrollIntoView');
  const event = clickLink(document.querySelector('a span')!);
  expect(event.defaultPrevented).toBe(true); expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  expect(document.querySelector('details')!.open).toBe(true); expect(document.activeElement).toBe(heading);
});

test('Korean encoded fragments and IDs containing selector punctuation or literal percent are supported', () => {
  for (const id of ['한글 제목', 'section:with[special].characters', '50%']) {
    document.body.innerHTML = '<a>Jump</a><h2>Target</h2>';
    const heading = document.querySelector('h2')!, anchor = document.querySelector('a')!;
    heading.id = id; anchor.setAttribute('href', '#' + (id === '50%' ? id : encodeURIComponent(id)));
    const scroll = vi.spyOn(heading, 'scrollIntoView');
    expect(clickLink(anchor).defaultPrevented).toBe(true); expect(scroll).toHaveBeenCalledOnce();
  }
});

test('missing fragments never navigate; empty fragments return to the document top', () => {
  document.body.innerHTML = '<a href="#absent">Missing</a><a href="#">Top</a>';
  const scroll = vi.spyOn(window, 'scrollTo');
  expect(clickLink(document.querySelector('a')!).defaultPrevented).toBe(true); expect(scroll).not.toHaveBeenCalled();
  expect(clickLink(document.querySelectorAll('a')[1]).defaultPrevented).toBe(true); expect(scroll).toHaveBeenCalledWith(0, 0);
});

test('SVG anchors and footnote backlinks work without capturing web or document URLs', () => {
  document.body.innerHTML = '<svg><a xlink:href="#footnote"><text>Note</text></a></svg><a name="footnote">Footnote</a><a href="https://example.com">Web</a><a href="other.html#section">Document</a>';
  const footnote = document.querySelector<HTMLAnchorElement>('a[name]')!, scroll = vi.spyOn(footnote, 'scrollIntoView');
  expect(clickLink(document.querySelector('svg text')!).defaultPrevented).toBe(true); expect(scroll).toHaveBeenCalledOnce();
  for (const anchor of document.querySelectorAll('a[href]')) expect(clickLink(anchor).defaultPrevented).toBe(false);
});

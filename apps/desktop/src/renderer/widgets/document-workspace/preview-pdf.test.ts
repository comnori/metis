// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { previewPdfHtml } from './preview-pdf';

test('PDF snapshot preserves vector diagrams, embedded fonts, custom CSS and all static D2 boards', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>시작 → 완료</text><foreignObject width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml">D2 설명</div></foreignObject></svg>';
  const html = `<html><head><style>@font-face{font-family:Diagram;src:url(data:font/woff;base64,AAAA)}</style></head><body><div class="metis-d2-output" data-preview-asset="d2"><section data-d2-board="root">${svg}</section><details data-d2-board="layers.detail"><summary>상세</summary>${svg}</details><section data-d2-board="animation">${svg}</section><div class="metis-d2-tools"><button>다운로드</button></div></div><div class="metis-mermaid-output"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Mermaid label</text><path d="M0 0L100 50"/></svg></div></body></html>`;
  const result = previewPdfHtml(html, 'body{font-family:"Malgun Gothic"}');
  const doc = new DOMParser().parseFromString(result, 'text/html');
  expect(doc.querySelectorAll('svg')).toHaveLength(3);
  expect(doc.querySelectorAll('foreignObject')).toHaveLength(2);
  expect(doc.querySelector('details')?.open).toBe(true);
  expect(doc.querySelector('[data-d2-board="animation"]')).toBeNull();
  expect(doc.querySelectorAll('button,.metis-d2-tools,iframe,meta')).toHaveLength(0);
  expect(doc.title).toBe('문서 미리보기');
  expect(result).toContain('data:font/woff;base64,AAAA'); expect(result).toContain('Malgun Gothic');
  expect(result).toContain('Mermaid label'); expect(result).toContain('max-height:245mm');
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('details')?.open).toBe(false);
});

test('PDF snapshots drop active embeds and restore web destinations', () => {
  const result = previewPdfHtml('<html><body><iframe srcdoc="ignored"></iframe><script>bad()</script><a href="#" data-web-url="https://example.com">문서</a><img loading="lazy" src="metis-attachment://resource/image"><video src="x"></video></body></html>', '');
  const doc = new DOMParser().parseFromString(result, 'text/html');
  expect(doc.querySelectorAll('script,iframe,video')).toHaveLength(0);
  expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  expect(doc.querySelector('img')?.hasAttribute('loading')).toBe(false);
  expect(doc.querySelector('img')?.getAttribute('src')).toBe('metis-attachment://resource/image');
});

// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true,"disableJavaScriptEvaluation":true}}
import { expect, test } from 'vitest';
import { convert } from '@asciidoctor/core';
import { renderYoutubePreview, youtubeAsset } from './youtube';
import { safePreview } from '../../widgets/document-workspace/preview';

function fragment(html: string) { const template = document.createElement('template'); template.innerHTML = html; return template.content; }

test('native AsciiDoc videos become bounded YouTube embeds only with extension output', async () => {
  const html = String(await convert('.Demo\nvideo::rPQoq7ThGAU[youtube,width=640,height=360,start=5,end=20,opts=autoplay]', { safe: 'secure' }));
  const disabled = safePreview(html); expect(disabled).not.toContain('<iframe'); expect(disabled).toContain('확장 관리'); expect(disabled).toContain("frame-src 'none'");
  const result = await renderYoutubePreview(html), page = safePreview(result.html, undefined, result.assets);
  const doc = fragment(page), frame = doc.querySelector('iframe')!;
  expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/rPQoq7ThGAU?rel=0&start=5&end=20');
  expect(frame.width).toBe('640'); expect(frame.height).toBe('360'); expect(frame.title).toContain('YouTube');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
  expect(page).toContain('Demo'); expect(page).toContain("script-src 'none'"); expect(page).not.toContain('autoplay');
});

test('untrusted iframe URLs, attributes and scripts cannot cross the host boundary', async () => {
  for (const url of ['https://evil.test/embed/rPQoq7ThGAU', 'https://www.youtube-nocookie.com.evil.test/embed/rPQoq7ThGAU', 'http://www.youtube.com/embed/rPQoq7ThGAU', 'https://user@www.youtube.com/embed/rPQoq7ThGAU', 'https://www.youtube.com:444/embed/rPQoq7ThGAU', 'https://www.youtube.com/embed/../watch', 'javascript:alert(1)', '//www.youtube.com/embed/rPQoq7ThGAU']) expect(youtubeAsset(url)).toBeUndefined();
  const result = await renderYoutubePreview('<div class="videoblock"><iframe src="https://www.youtube.com/embed/rPQoq7ThGAU?start=-1&amp;end=999999&amp;autoplay=1" srcdoc="attack" onload="attack()" width="9999" height="1"></iframe><iframe src="https://evil.test"></iframe><script>attack()</script></div>');
  const page = safePreview(result.html, undefined, result.assets), doc = fragment(page);
  expect(doc.querySelectorAll('iframe')).toHaveLength(1); expect(doc.querySelector('iframe')?.height).toBe('200');
  expect(page).not.toMatch(/attack|srcdoc=|autoplay|start=|end=|evil\.test/);
  expect(safePreview('<div data-preview-asset="forged"></div>')).not.toContain('<iframe');
});

test('video count is bounded and surplus videos have a visible fallback', async () => {
  const result = await renderYoutubePreview('<div class="videoblock"><iframe src="https://www.youtube.com/embed/rPQoq7ThGAU"></iframe></div>'.repeat(101));
  expect(result.assets.size).toBe(100); expect(result.html).toContain('한도');
});

// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { attachmentMacro } from './attachments';
import { safePreview, showAttachmentErrors } from './preview';
test('insertion keeps standard relative macros and honors imagesdir', () => {
  expect(attachmentMacro('docs/note.adoc', { relativePath: 'docs/assets/a 한.png', kind: 'image' }, 'assets')).toBe('image::a%20%ED%95%9C.png[a 한.png]');
  expect(attachmentMacro('docs/note.adoc', { relativePath: 'assets/report.pdf', kind: 'file' })).toBe('link:../assets/report.pdf[report.pdf]');
  expect(attachmentMacro('note.adoc', { relativePath: 'assets/song.wav', kind: 'audio' })).toBe('audio::assets/song.wav[]');
  expect(() => attachmentMacro('note.adoc', { relativePath: 'assets/a.png', kind: 'image' }, 'https://example.com')).toThrow();
});
test('already-failed media receives a single fallback notice after frame load', () => {
  const doc = new DOMParser().parseFromString('<video src="local.mp4"></video>', 'text/html');
  const media = doc.querySelector('video')!;
  Object.defineProperty(media, 'error', { value: { code: 4 } });
  showAttachmentErrors(doc);
  media.dispatchEvent(new Event('error'));
  expect(doc.querySelectorAll('.attachment-error')).toHaveLength(1);
  expect(doc.body.textContent).toContain('첨부 열기');
});
test('preview permits only registered media and never trusts source tokens or scripts', () => {
  const html = safePreview('<div><img src="assets/a.svg"><img src="https://example.com/a.png"><audio src="song.wav" autoplay></audio><a href="report.pdf">Report</a><a href="#" data-attachment-token="forged">fake</a><img src="evil.png" onload="evil()"><iframe src="about:blank"></iframe></div>', undefined, undefined, [
    { target: 'assets/a.svg', token: 'image', kind: 'image', url: 'metis-attachment://resource/image' },
    { target: 'song.wav', token: 'audio', kind: 'audio', url: 'metis-attachment://resource/audio' },
    { target: 'report.pdf', token: 'pdf', kind: 'file', url: 'metis-attachment://resource/pdf' }
  ]);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  expect(dom.querySelector('img')?.getAttribute('src')).toBe('metis-attachment://resource/image');
  expect(dom.querySelectorAll('img')[1].hasAttribute('src')).toBe(false);
  expect(dom.querySelector('audio')?.hasAttribute('controls')).toBe(true);
  expect(dom.querySelector('audio')?.hasAttribute('autoplay')).toBe(false);
  expect(dom.querySelector('[data-attachment-token="pdf"]')).not.toBeNull();
  expect(dom.querySelector('[data-attachment-token="forged"]')).toBeNull();
  expect(dom.querySelector('[onload],iframe')).toBeNull();
});

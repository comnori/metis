import { expect, test, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), dialog: {} }));
import { inlinePdfAttachments } from './preview-pdf';
import { validate, maxPreviewPdfLength } from '@metis/contracts';

test('PDF requests are bounded, scoped and cannot supply an output path', () => {
  const request = { requestId: 'pdf', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'docs/note.adoc', html: '<h1>문서</h1>' };
  expect(validate('exportPreviewPdf', request)).toEqual(request);
  for (const change of [{ workspaceEpoch: 0 }, { relativePath: '../secret.adoc' }, { relativePath: 'a.exe' }, { outputPath: 'C:/secret' }, { html: '' }, { html: 'x'.repeat(maxPreviewPdfLength + 1) }]) {
    expect(() => validate('exportPreviewPdf', { ...request, ...change })).toThrow();
  }
});

test('PDF image snapshot embeds duplicate local URLs once and rejects missing or oversized resources', async () => {
  const read = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '3' } }));
  const html = '<img src="metis-attachment://resource/image"><img src="metis-attachment://resource/image">';
  expect(await inlinePdfAttachments(html, read)).toBe('<img src="data:image/png;base64,AQID"><img src="data:image/png;base64,AQID">');
  expect(read).toHaveBeenCalledTimes(1);
  await expect(inlinePdfAttachments(html, async () => new Response(null, { status: 404 }))).rejects.toThrow();
  await expect(inlinePdfAttachments(html, async () => new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(17 * 1024 * 1024) } }))).rejects.toThrow();
});

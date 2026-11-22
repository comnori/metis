import { BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoundaryError, type PreviewPdfRequest } from '@metis/contracts';
import type { Attachments } from '@metis/workspace';

let exporting = false;
const maxImageBytes = 16 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024;

export async function inlinePdfAttachments(html: string, read: (url: string) => Promise<Response>): Promise<string> {
  let size = Buffer.byteLength(html);
  const urls = [...new Set(html.match(/metis-attachment:\/\/resource\/[\w-]+/g) ?? [])];
  if (urls.length > 1000) throw new BoundaryError('TOO_LARGE', 'PDF에 포함할 이미지가 너무 많습니다.');
  for (const url of urls) {
    const response = await read(url);
    const mime = response.headers.get('content-type') ?? '';
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || !/^image\/[a-z0-9.+-]+$/i.test(mime) || !Number.isSafeInteger(length) || length > maxImageBytes || size + length * 4 / 3 > maxTotalBytes) {
      await response.body?.cancel();
      throw new BoundaryError('TOO_LARGE', 'PDF 이미지를 읽지 못했거나 크기 한도를 초과했습니다. 이미지당 16 MiB, 전체 64 MiB까지 지원합니다.');
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxImageBytes) throw new BoundaryError('TOO_LARGE', 'PDF 이미지 크기 한도를 초과했습니다.');
    const embedded = `data:${mime};base64,${data.toString('base64')}`;
    html = html.replaceAll(url, embedded);
    size = Buffer.byteLength(html);
    if (size > maxTotalBytes) throw new BoundaryError('TOO_LARGE', 'PDF 이미지 합계 크기 한도를 초과했습니다.');
  }
  return html;
}

const readyForPrint = `(async () => {
  await document.fonts.ready;
  const images = [...document.images];
  for (const svgImage of document.querySelectorAll('svg image')) {
    const href = svgImage.getAttribute('href') || svgImage.getAttribute('xlink:href');
    if (href && !href.startsWith('#')) { const image = new Image(); image.src = href; images.push(image); }
  }
  await Promise.all(images.map(image => image.decode().catch(() => { throw Error('이미지 로딩에 실패했습니다. 미리보기의 이미지를 확인하세요.'); })));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

export async function exportPreviewPdf(parent: BrowserWindow, request: PreviewPdfRequest, attachments: Attachments, checkScope: () => void): Promise<{ saved: boolean }> {
  if (exporting) throw new BoundaryError('BUSY', '진행 중인 PDF 저장을 먼저 완료하세요.');
  exporting = true;
  let renderer: BrowserWindow | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    checkScope();
    // Copy local images before opening the dialog so editing or closing a preview cannot revoke them.
    const html = await inlinePdfAttachments(request.html, async url => {
      checkScope();
      await attachments.resolveToken(new URL(url).pathname.slice(1), request);
      return attachments.response(url, null);
    });
    checkScope();
    renderer = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { partition: `metis-pdf-${randomUUID()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    renderer.webContents.on('will-navigate', event => event.preventDefault());
    renderer.webContents.on('will-redirect', event => event.preventDefault());
    renderer.webContents.on('will-attach-webview', event => event.preventDefault());
    const session = renderer.webContents.session;
    session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !(details.url.startsWith('data:') || details.resourceType === 'image' && details.url.startsWith('https://')) }));
    const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const document = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${html}`;
    const window = renderer;
    const pdf = await Promise.race([
      (async () => {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
        try { await window.webContents.executeJavaScript(readyForPrint); }
        catch { throw new BoundaryError('INTERNAL_ERROR', 'PDF의 다이어그램·이미지를 준비하지 못했습니다. 미리보기의 이미지 상태를 확인하고 다시 시도하세요.'); }
        checkScope();
        return window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, generateDocumentOutline: true });
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BoundaryError('INTERNAL_ERROR', 'PDF 준비 시간이 초과되었습니다. 이미지 로딩 상태를 확인하고 다시 시도하세요.')), 30000); })
    ]);
    clearTimeout(timer); renderer.destroy(); renderer = undefined;
    checkScope();
    const choice = await dialog.showSaveDialog(parent, { title: '미리보기 PDF 저장', defaultPath: path.posix.basename(request.relativePath).replace(/\.adoc$/i, '.pdf'), filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { saved: false };
    checkScope();
    await fs.writeFile(choice.filePath, pdf, { flush: true });
    return { saved: true };
  } finally { clearTimeout(timer); renderer?.destroy(); exporting = false; }
}

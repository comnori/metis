import { BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { BoundaryError, type D2ExportRequest } from '@metis/contracts';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

let exporting = false;
function dimensions(svg: string) {
  const tag = /^\s*(?:<\?xml[^>]*>\s*)?(<svg\b[^>]*>)/.exec(svg)?.[1] ?? '';
  const box = /\bviewBox=["']([^"']+)["']/.exec(tag)?.[1].trim().split(/[ ,]+/).map(Number);
  const width = box?.[2] ?? 1200, height = box?.[3] ?? 900;
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw Error('D2 SVG 크기를 확인할 수 없습니다.');
  const scale = Math.min(2, 2400 / Math.max(width, height));
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
}
export async function exportD2(parent: BrowserWindow, request: D2ExportRequest, checkScope: () => void): Promise<{ saved: boolean }> {
  if (exporting) throw new BoundaryError('BUSY', 'D2 저장을 먼저 완료하세요.');
  exporting = true;
  let renderer: BrowserWindow | undefined;
  try {
    checkScope();
    const choice = await dialog.showSaveDialog(parent, { title: 'D2 다이어그램 저장', defaultPath: `${request.name}.${request.format}`, filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }] });
    if (choice.canceled || !choice.filePath) return { saved: false };
    checkScope();
    let output: Uint8Array | string;
    if (request.format === 'svg' || request.format === 'txt') output = request.frames[0];
    else {
      const sizes = request.frames.map(dimensions);
      const width = Math.max(...sizes.map(s => s.width)), height = Math.max(...sizes.map(s => s.height));
      renderer = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
      renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      renderer.webContents.on('will-navigate', event => event.preventDefault());
      renderer.webContents.on('will-attach-webview', event => event.preventDefault());
      const gif = request.format === 'gif' ? GIFEncoder() : undefined;
      for (const svg of request.frames) {
        checkScope();
        const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
        const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>@page{margin:0}html,body{margin:0;width:100%;height:100%;background:white}body>svg{width:100%;height:100%;display:block}</style></head><body>${svg.replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="xMidYMid meet"')}</body></html>`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([renderer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('D2 이미지 로딩 시간 초과')), 15000); })]);
          await renderer.webContents.executeJavaScript('Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
          if (request.format === 'pdf') output = await renderer.webContents.printToPDF({ printBackground: true, preferCSSPageSize: false, pageSize: { width: width / 96, height: height / 96 }, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          else {
            const image = await renderer.webContents.capturePage();
            if (gif) {
              const size = image.getSize(), rgba = image.toBitmap();
              // Electron bitmaps are BGRA on supported little-endian platforms.
              for (let i = 0; i < rgba.length; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b; }
              const palette = quantize(rgba, 256);
              gif.writeFrame(applyPalette(rgba, palette), size.width, size.height, { palette, delay: request.interval ?? 1000, repeat: 0 });
            } else output = image.toPNG();
          }
        } finally { clearTimeout(timer); }
      }
      if (gif) { gif.finish(); output = gif.bytes(); }
    }
    checkScope();
    await fs.writeFile(choice.filePath, output!, { flush: true });
    return { saved: true };
  } finally { renderer?.destroy(); exporting = false; }
}

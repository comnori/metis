import type { PreviewAsset } from '@metis/contracts';
import { safeSvg } from './preview-svg';
import { safeD2Svg } from './d2-svg';
import { d2BoardLabel } from './d2-preview';

export function mountPreviewAssets(doc: DocumentFragment, assets: ReadonlyMap<string, PreviewAsset>): boolean {
  let hasVideo = false;
  let menuIndex = 0;
  for (const slot of doc.querySelectorAll<HTMLElement>('[data-preview-asset]')) {
    const asset = assets.get(slot.dataset.previewAsset ?? '');
    if (asset?.kind === 'svg') slot.innerHTML = safeSvg(asset.svg);
    else if (asset?.kind === 'd2') {
      slot.replaceChildren();
      for (const [index, board] of asset.boards.entries()) {
        const collapsible = asset.boards.length > 1 && board.name !== 'root' && board.name !== 'animation';
        const section = doc.ownerDocument.createElement(collapsible ? 'details' : 'section'); section.className = 'metis-d2-board';
        section.dataset.d2Board = board.name;
        if (collapsible) {
          const summary = doc.ownerDocument.createElement('summary'); summary.textContent = d2BoardLabel(board.name);
          section.append(summary);
        }
        const canvas = doc.ownerDocument.createElement('div'); canvas.className = 'metis-d2-canvas';
        const output = doc.ownerDocument.createElement('div'); output.className = 'metis-d2-diagram'; output.innerHTML = safeD2Svg(board.svg);
        if (board.ascii !== undefined) { const pre = doc.ownerDocument.createElement('pre'); pre.textContent = board.ascii; output.append(pre); }
        const toolbar = doc.ownerDocument.createElement('div'); toolbar.className = 'metis-d2-tools';
        const toggle = doc.ownerDocument.createElement('button'); toggle.type = 'button'; toggle.className = 'metis-d2-download';
        toggle.dataset.d2MenuToggle = ''; toggle.setAttribute('aria-label', '다이어그램 다운로드'); toggle.title = '다이어그램 다운로드';
        toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-expanded', 'false');
        const menu = doc.ownerDocument.createElement('div'); menu.className = 'metis-d2-menu'; menu.dataset.d2Menu = ''; menu.id = `metis-d2-download-${menuIndex++}`;
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '다운로드 형식'); menu.hidden = true;
        toggle.setAttribute('aria-controls', menu.id);
        toggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/></svg>';
        toolbar.append(toggle, menu);
        for (const format of board.svg ? ['svg', 'png', 'pdf', ...(asset.boards.length > 1 ? ['gif'] : [])] : ['txt']) {
          const button = doc.ownerDocument.createElement('button'); button.type = 'button'; button.textContent = format.toUpperCase();
          button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
          const hint = doc.ownerDocument.createElement('span'); hint.setAttribute('aria-hidden', 'true');
          hint.textContent = ({ svg: '벡터 이미지', png: '이미지', pdf: '문서', gif: '보드 애니메이션', txt: '텍스트' } as Record<string, string>)[format]; button.append(hint);
          button.dataset.d2Export = format; button.dataset.d2Asset = slot.dataset.previewAsset; button.dataset.d2Index = String(index); menu.append(button);
        }
        canvas.append(toolbar, output); section.append(canvas); slot.append(section);
      }
    }
    else if (asset?.kind === 'youtube' && typeof asset.videoId === 'string' && /^[\w-]{11}$/.test(asset.videoId)) {
      const url = new URL(`https://www.youtube-nocookie.com/embed/${asset.videoId}`);
      url.searchParams.set('rel', '0');
      for (const name of ['start', 'end'] as const) {
        const value = asset[name]; if (Number.isSafeInteger(value) && value! >= 0 && value! <= 86400) url.searchParams.set(name, String(value));
      }
      const frame = doc.ownerDocument.createElement('iframe'); frame.src = url.href; frame.title = `YouTube 영상: ${asset.videoId}`;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      frame.setAttribute('allow', 'encrypted-media; fullscreen; picture-in-picture'); frame.setAttribute('allowfullscreen', '');
      frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.loading = 'lazy';
      for (const name of ['width', 'height'] as const) {
        const value = asset[name]; frame.setAttribute(name, String(Number.isSafeInteger(value) ? Math.min(4096, Math.max(200, value!)) : name === 'width' ? 640 : 360));
      }
      slot.replaceChildren(frame); hasVideo = true;
    }
  }
  return hasVideo;
}

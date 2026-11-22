import type { ExtensionDefinition, ExtensionPreviewResult, PreviewAsset } from '@metis/contracts';

// Read only the native Asciidoctor embed form; never carry document iframe attributes forward.
export function youtubeAsset(source: string): Extract<PreviewAsset, { kind: 'youtube' }> | undefined {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.hash) return;
    const match = /^\/embed\/([\w-]{11})$/.exec(url.pathname); if (!match) return;
    const seconds = (name: string) => { const value = url.searchParams.get(name); return value && /^\d{1,5}$/.test(value) && Number(value) <= 86400 ? Number(value) : undefined; };
    return { kind: 'youtube', videoId: match[1], start: seconds('start'), end: seconds('end') };
  } catch { return; }
}

export async function renderYoutubePreview(html: string): Promise<ExtensionPreviewResult> {
  const template = document.createElement('template'); template.innerHTML = html;
  const doc = template.content, assets = new Map<string, PreviewAsset>();
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>('.videoblock iframe[src]')) {
    const asset = youtubeAsset(frame.getAttribute('src') ?? ''); if (!asset) continue;
    const slot = document.createElement('div'); slot.className = 'metis-youtube';
    if (assets.size >= 100) { slot.textContent = 'YouTube 영상 한도(문서당 100개)를 초과했습니다.'; frame.replaceWith(slot); continue; }
    const dimension = (name: string) => { const value = frame.getAttribute(name); return value && /^\d{1,4}$/.test(value) ? Math.min(4096, Math.max(200, Number(value))) : undefined; };
    asset.width = dimension('width'); asset.height = dimension('height');
    const token = `youtube-${assets.size}`; assets.set(token, asset); slot.dataset.previewAsset = token;
    frame.replaceWith(slot);
  }
  return { html: template.innerHTML, assets, diagnostics: [] };
}

export const youtubeExtension: ExtensionDefinition = {
  id: 'youtube', name: 'YouTube 영상',
  description: 'video::영상ID[youtube] 영상을 미리보기에서 재생합니다. 활성화하면 YouTube에 연결합니다. 자동 재생은 하지 않습니다.',
  activate(api) { api.preview('videos', ({ html }) => renderYoutubePreview(html)); }
};

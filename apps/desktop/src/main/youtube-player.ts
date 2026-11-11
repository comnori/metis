export const youtubeAppId = 'comnori.metis';

export function youtubeReferer(url: string, resourceType: string, webContentsId: number | undefined, owner: number): string | undefined {
  if (resourceType !== 'subFrame' || webContentsId !== owner) return;
  try {
    const target = new URL(url);
    if (target.origin === 'https://www.youtube-nocookie.com' && /^\/embed\/[\w-]{11}$/.test(target.pathname)
      && !target.username && !target.password) return `https://${youtubeAppId}/`;
  } catch { /* Unrecognized requests keep their original headers. */ }
}

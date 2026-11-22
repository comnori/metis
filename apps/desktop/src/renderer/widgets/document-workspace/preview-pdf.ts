// Export the already rendered SVGs, including D2's embedded fonts and foreignObject labels.
// A second AsciiDoc conversion would lose extension output and unsaved changes.
export function previewPdfHtml(srcDoc: string, customCss: string): string {
  const doc = new DOMParser().parseFromString(srcDoc, 'text/html');
  doc.title = doc.querySelector('h1')?.textContent?.trim() || '문서 미리보기';
  for (const element of doc.querySelectorAll('script,iframe,object,embed,form,input,button,link,base,meta,.metis-d2-tools,.metis-attachment-link')) element.remove();
  for (const media of doc.querySelectorAll('audio,video')) {
    const note = doc.createElement('p'); note.textContent = '오디오·영상은 미리보기에서 재생할 수 있습니다.'; media.replaceWith(note);
  }
  for (const slot of doc.querySelectorAll('[data-preview-asset]')) {
    // D2 animations also contain static boards; print those instead of an arbitrary animation frame.
    if (slot.querySelector('[data-d2-board]:not([data-d2-board="animation"])')) slot.querySelector('[data-d2-board="animation"]')?.remove();
  }
  for (const detail of doc.querySelectorAll('details')) detail.open = true;
  for (const anchor of doc.querySelectorAll('a[data-web-url]')) anchor.setAttribute('href', anchor.getAttribute('data-web-url')!);
  for (const image of doc.querySelectorAll('img')) image.removeAttribute('loading');
  const custom = doc.createElement('style'); custom.textContent = customCss; doc.head.append(custom);
  const print = doc.createElement('style');
  print.textContent = `@page{size:A4;margin:12mm}
    html,body{width:auto!important;min-width:0!important;height:auto!important;overflow:visible!important}
    body{padding:0!important;margin:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    *,*::before,*::after{animation-play-state:paused!important;transition:none!important}
    h1,h2,h3,h4,h5,h6{break-after:avoid}p{orphans:3;widows:3}
    pre{white-space:pre-wrap!important;overflow-wrap:anywhere!important;overflow:visible!important}
    table{max-width:100%!important}img{max-width:100%!important;max-height:245mm;object-fit:contain}
    .metis-d2-board,.metis-mermaid{break-inside:avoid;page-break-inside:avoid}
    .metis-d2-canvas{padding-top:0!important}.metis-d2-diagram{overflow:visible!important}
    .metis-d2-board>summary{display:block!important}.metis-d2-board>summary::before{display:none!important}
    .metis-d2-diagram>svg,.metis-mermaid-output svg{display:block!important;width:auto!important;height:auto!important;max-width:100%!important;max-height:245mm!important;margin:0 auto}
    .metis-d2-tools,.metis-attachment-link{display:none!important}`;
  doc.head.append(print);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

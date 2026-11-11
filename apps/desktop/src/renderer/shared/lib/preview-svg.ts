import DOMPurify from 'dompurify';

export function safeSvg(svg: string): string {
  const source = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const blockedTags = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image']);
  for (const element of [...source.querySelectorAll('*')]) {
    if (blockedTags.has(element.tagName.toLowerCase())) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || /^(?:javascript|https?|file|data):/i.test(value)
        || (name === 'style' && /url\((?!\s*['"]?#)/i.test(value))) element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  const manuallyCleaned = new XMLSerializer().serializeToString(source.documentElement);
  const clean = DOMPurify.sanitize(manuallyCleaned, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror', 'onmouseover', 'onfocus']
  });
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName.toLowerCase() !== 'svg') return manuallyCleaned;
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || /^(?:javascript|https?|file|data):/i.test(value)
        || (name === 'style' && /url\((?!\s*['"]?#)/i.test(value))) element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  for (const style of document.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '').replaceAll(/@import\s+[^;]+;/gi, '').replaceAll(/url\((?!\s*['"]?#)[^)]+\)/gi, 'none');
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

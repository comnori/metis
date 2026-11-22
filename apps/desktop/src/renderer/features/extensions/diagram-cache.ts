/** Bounded per-activation cache; source line numbers and block order are not render inputs. */
export class DiagramCache<T> {
  private entries = new Map<string, { value: T; size: number }>();
  private size = 0;
  constructor(private limit = 32 * 1024 * 1024, private count = 200) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    return entry?.value;
  }
  set(key: string, value: T, bytes: number) {
    const previous = this.entries.get(key);
    if (previous) { this.size -= previous.size; this.entries.delete(key); }
    const size = bytes + key.length * 2;
    if (size > this.limit) return;
    this.entries.set(key, { value, size }); this.size += size;
    while (this.size > this.limit || this.entries.size > this.count) {
      const oldest = this.entries.keys().next().value!;
      this.size -= this.entries.get(oldest)!.size; this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.size = 0; }
}

export async function diagramFingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Cached SVGs may move or occur twice. Give each instance independent IDs and references. */
export function scopeDiagramSvg(svg: string, prefix: string): string {
  if (!svg) return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;
  const ids = new Map<string, string>();
  for (const element of doc.querySelectorAll('[id]')) if (!ids.has(element.id)) ids.set(element.id, `${prefix}-${ids.size}`);
  const urls = (value: string) => value.replace(/url\(\s*(['"]?)#([^\s)'"]+)\1\s*\)/g, (match, _quote, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
  const selectors = (value: string) => {
    for (const [id, next] of ids) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      value = value.replace(new RegExp(`#${escaped}(?![\\w-])`, 'g'), `#${next}`);
    }
    return value;
  };
  for (const element of doc.querySelectorAll('*')) {
    for (const attr of [...element.attributes]) {
      if (attr.name === 'id') element.setAttribute('id', ids.get(attr.value)!);
      else if (['href', 'xlink:href'].includes(attr.name) && ids.has(attr.value.slice(1)) && attr.value.startsWith('#')) element.setAttribute(attr.name, `#${ids.get(attr.value.slice(1))}`);
      else if (['aria-labelledby', 'aria-describedby'].includes(attr.name)) element.setAttribute(attr.name, attr.value.split(/\s+/).map(id => ids.get(id) ?? id).join(' '));
      else if (attr.value.includes('url(')) element.setAttribute(attr.name, urls(attr.value));
    }
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = urls((style.textContent ?? '').replace(/([^{}]+)\{/g, (_match, selector: string) => `${selectors(selector)}{`));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

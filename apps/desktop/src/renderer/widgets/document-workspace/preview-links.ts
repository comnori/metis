import type { Relation } from '@metis/contracts';

/** Fragment URLs in srcdoc resolve against the host file URL in Chromium.
 * Handle them in the existing document so TOC/footnote clicks cannot replace
 * the preview with the application page or a blocked-navigation error page. */
export function followPreviewFragment(event: MouseEvent, doc: Document): boolean {
  const anchor = (event.target as Element | null)?.closest?.('a');
  const href = anchor?.getAttribute('href') ?? anchor?.getAttribute('xlink:href');
  if (!href?.startsWith('#')) return false;
  event.preventDefault();
  if (href === '#') { doc.defaultView?.scrollTo(0, 0); return true; }
  const fragment = href.slice(1);
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* A literal '%' is valid in an HTML ID. */ }
  const target = doc.getElementById(fragment) ?? doc.getElementById(decoded)
    ?? [...doc.querySelectorAll<HTMLAnchorElement>('a[name]')].find(element => element.getAttribute('name') === fragment || element.getAttribute('name') === decoded);
  if (target) {
    // Expand hidden example/diagram details before aligning the destination.
    for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent.localName === 'details') (parent as HTMLDetailsElement).open = true;
    target.scrollIntoView({ block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  return true;
}

export function previewRelations(target: string, relations: Relation[]) {
  const source = target.replace(/\.html(?=#|$)/, '.adoc');
  return relations.filter(r => r.kind === 'xref' && r.target === source);
}

export function previewDestination(target: string, relations: Relation[]) {
  const matches = previewRelations(target, relations), first = matches[0]?.destination;
  // An included document can produce the same href from a different directory.
  if (!first || matches.some(r => r.sourceUncertain || r.state !== 'resolved' || r.destination?.relativePath !== first.relativePath || r.destination.line !== first.line)) return;
  return first;
}

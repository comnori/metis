import type { AbstractBlock, Document, Inline } from '@asciidoctor/core';
import type { PreviewLocation, SourceLocation } from '@metis/contracts';
import { sourceCursor } from './source-cursor';

/** Attach source locations to converted block roots without changing AsciiDoc parsing. */
export function trackPreviewLocations(doc: Document, locate: (file: unknown, line: number) => SourceLocation, recover: (source: SourceLocation, text: string) => SourceLocation & { sourceUncertain?: boolean }): PreviewLocation[] {
  const locations: PreviewLocation[] = [];
  const converter = doc.getConverter() as { convert(node: AbstractBlock | Inline, transform?: string, opts?: unknown): Promise<string> };
  const convert = converter.convert.bind(converter);
  converter.convert = async (node, transform, opts) => {
    const html = await convert(node, transform, opts);
    if (locations.length >= 4000 || node === doc || node.getNodeName().startsWith('inline_') || !('getSourceLocation' in node)) return html;
    const cursor = node.getSourceLocation(); if (!cursor) return html;
    const position = sourceCursor(cursor);
    const block = node as AbstractBlock & { getSource?(): string };
    const source = recover(locate(position.file, position.line), block.getSource?.() ?? '');
    if (source.sourceUncertain || !/^\s*<[a-z][\w:-]*(?=[\s>])/i.test(html)) return html;
    const token = `block-${locations.length}`;
    locations.push({ token, relativePath: source.relativePath, line: source.line });
    return html.replace(/^(\s*<[a-z][\w:-]*)(?=[\s>])/i, `$1 data-metis-source="${token}"`);
  };
  return locations;
}

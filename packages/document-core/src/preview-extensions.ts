import { BlockProcessor, SyntaxHighlighterBase, type AbstractBlock, type Block, type Reader } from '@asciidoctor/core';
import hljs from 'highlight.js/lib/common';
import type { Diagnostic, SourceLocation } from '@metis/contracts';
import { sourceCursor } from './source-cursor';

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export class MetisHighlighter extends SyntaxHighlighterBase {
  constructor(private readonly diagnostics: Diagnostic[], private readonly locate: (file: unknown, line: number) => SourceLocation) {
    super('metis-highlight');
    this._preClass = 'highlight';
  }
  handlesHighlighting() { return true; }
  highlight(node: Block, source: string, language: string) {
    if (language && hljs.getLanguage(language)) return hljs.highlight(source, { language, ignoreIllegals: true }).value;
    const cursor = sourceCursor(node.getSourceLocation());
    this.diagnostics.push({ ...this.locate(cursor.file, cursor.line), message: `지원하지 않는 코드 언어: ${language || '(지정되지 않음)'}` });
    return escapeHtml(source);
  }
}

export function mermaidBlockProcessor(diagnostics: Diagnostic[], locate: (file: unknown, line: number) => SourceLocation) {
  let count = 0;
  return class MermaidBlock extends BlockProcessor {
    static config = { name: 'mermaid', contexts: ['listing'], contentModel: 'verbatim' };
    process(parent: AbstractBlock, reader: Reader, attributes: Record<string, unknown>) {
      const position = locate(reader.file, Math.max(1, reader.lineno));
      const source = reader.lines.join('\n');
      reader.terminate();
      if (++count > 100) {
        diagnostics.push({ ...position, message: 'Mermaid 다이어그램 한도(문서당 100개)를 초과했습니다.' });
        return this.createBlock(parent as Block, 'pass', `<div class="metis-mermaid-error"><p>Mermaid 다이어그램 한도를 초과했습니다.</p><pre><code>${escapeHtml(source)}</code></pre></div>`, attributes);
      }
      const id = typeof attributes.id === 'string' ? attributes.id : '';
      const title = typeof attributes.title === 'string' ? attributes.title : '';
      const attr = (name: string, value: string | number) => ` data-mermaid-${name}="${escapeHtml(String(value))}"`;
      const html = `<div class="metis-mermaid"${id ? ` id="${escapeHtml(id)}"` : ''}${attr('path', position.relativePath)}${attr('line', position.line)}>${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}<pre><code>${escapeHtml(source)}</code></pre></div>`;
      return this.createBlock(parent as Block, 'pass', html, attributes);
    }
  };
}

export function d2BlockProcessor(diagnostics: Diagnostic[], locate: (file: unknown, line: number) => SourceLocation) {
  let count = 0;
  return class D2Block extends BlockProcessor {
    // Compound gives the extension a cursor-bearing reader in Asciidoctor 4.
    // Consume it verbatim here and terminate it before any AsciiDoc block parse.
    static config = { name: 'd2', contexts: ['listing'], contentModel: 'compound' };
    process(parent: AbstractBlock, reader: Reader, attributes: Record<string, unknown>) {
      const position = locate(reader.file, Math.max(1, reader.lineno));
      const source = reader.lines.join('\n'); reader.terminate();
      if (++count > 100) {
        diagnostics.push({ ...position, message: 'D2 다이어그램 한도(문서당 100개)를 초과했습니다.' });
        return this.createBlock(parent as Block, 'pass', `<div class="metis-d2-error"><p>D2 다이어그램 한도를 초과했습니다.</p><pre><code>${escapeHtml(source)}</code></pre></div>`, attributes);
      }
      const options = Object.fromEntries(['layout', 'theme', 'dark-theme', 'sketch', 'center', 'pad', 'scale', 'appendix', 'target', 'animate-interval', 'ascii', 'ascii-mode', 'isometric', 'font-regular', 'font-bold', 'font-italic', 'font-semibold'].filter(key => attributes[key] !== undefined).map(key => [key, String(attributes[key])]));
      const id = typeof attributes.id === 'string' ? attributes.id : '';
      const title = typeof attributes.title === 'string' ? attributes.title : '';
      return this.createBlock(parent as Block, 'pass', `<div class="metis-d2"${id ? ` id="${escapeHtml(id)}"` : ''} data-d2-path="${escapeHtml(position.relativePath)}" data-d2-line="${position.line}" data-d2-options="${escapeHtml(JSON.stringify(options))}">${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}<pre><code>${escapeHtml(source)}</code></pre></div>`, attributes);
    }
  };
}

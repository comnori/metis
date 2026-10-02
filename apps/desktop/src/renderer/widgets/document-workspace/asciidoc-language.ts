import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, foldService } from '@codemirror/language';
// Lexical editing aid only. Semantic sections and diagnostics come from Asciidoctor.
export const asciidocLanguage = StreamLanguage.define({
  startState: () => ({ delimiter: '' }),
  token(stream, state) {
    if (stream.sol()) {
      if (state.delimiter) {
        const delimiter = state.delimiter;
        if (stream.string === delimiter) state.delimiter = '';
        stream.skipToEnd(); return delimiter === '////' ? 'comment' : 'string';
      }
      if (stream.match(/^(----|\.\.\.\.|\+\+\+\+|\/\/\/\/)$/)) { state.delimiter = stream.string; return state.delimiter === '////' ? 'comment' : 'meta'; }
      if (stream.match(/^\/\/.*$/)) return 'comment';
      if (stream.match(/^={1,6}\s+.*$/)) return 'heading';
      if (stream.match(/^:[^:]+:.*$/)) return 'propertyName';
      if (stream.match(/^(?:include|ifdef|ifndef|endif|image|video|audio)::[^\[]*/)) return 'keyword';
      if (stream.match(/^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):/)) return 'keyword';
      if (stream.match(/^\[.*\]$/)) return 'meta';
      if (stream.match(/^\s*(?:\*+|\.+|-)\s+/)) return 'list';
    }
    if (stream.match(/^\{[^}]+\}/)) return 'variableName';
    if (stream.match(/^<<[^>]+>>|^(?:xref|link):[^\s\[]+/)) return 'link';
    if (stream.match(/^\*[^*\n]+\*/)) return 'strong';
    if (stream.match(/^_[^_\n]+_/)) return 'emphasis';
    if (stream.match(/^`[^`\n]+`/)) return 'monospace';
    stream.next(); return null;
  }
});
export const asciidocHighlighting = syntaxHighlighting(defaultHighlightStyle);

export const asciidocFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  const headingMatch = text.match(/^(=+)\s+/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    let end = line.to;
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      const nextMatch = nextLine.text.match(/^(=+)\s+/);
      if (nextMatch && nextMatch[1].length <= level) break;
      end = nextLine.to;
    }
    if (end > line.to) return { from: line.to, to: end };
  }

  const delimMatch = text.match(/^(----+|\.\.\.\.+|\+\+\+\+|\/\/\/\/|\*\*\*\*|\|===+)$/);
  if (delimMatch) {
    const delim = delimMatch[1];
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      if (nextLine.text.trim() === delim) {
        return { from: line.to, to: nextLine.to };
      }
    }
  }
  return null;
});


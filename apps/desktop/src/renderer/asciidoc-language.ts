import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
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

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { asciidocFolding } from './asciidoc-language';

describe('asciidocFolding', () => {
  it('folds section headings based on heading level', () => {
    const doc = [
      '= Document Title',
      'Intro paragraph 1',
      'Intro paragraph 2',
      '== Section 1',
      'Content for section 1',
      '=== Sub Section 1.1',
      'Sub content',
      '== Section 2',
      'Content for section 2'
    ].join('\n');

    const state = EditorState.create({ doc, extensions: [asciidocFolding] });

    // Title line (line 1, from 0 to 16)
    const titleFold = foldable(state, 0, 16);
    expect(titleFold).not.toBeNull();
    expect(titleFold?.from).toBe(16);
    expect(titleFold?.to).toBe(state.doc.length);

    // Section 1 line (line 4)
    const sec1Line = state.doc.line(4);
    const sec1Fold = foldable(state, sec1Line.from, sec1Line.to);
    expect(sec1Fold).not.toBeNull();
    // Should fold up to the start of Section 2 (line 7 end)
    const subContentLine = state.doc.line(7);
    expect(sec1Fold?.to).toBe(subContentLine.to);

    // Sub Section 1.1 (line 6)
    const subLine = state.doc.line(6);
    const subFold = foldable(state, subLine.from, subLine.to);
    expect(subFold).not.toBeNull();
    expect(subFold?.to).toBe(subContentLine.to);
  });

  it('folds delimited blocks like source and quote blocks', () => {
    const doc = [
      '= Title',
      '[source,typescript]',
      '----',
      'const x = 1;',
      'const y = 2;',
      '----',
      'After block'
    ].join('\n');

    const state = EditorState.create({ doc, extensions: [asciidocFolding] });

    const openDelimLine = state.doc.line(3);
    const blockFold = foldable(state, openDelimLine.from, openDelimLine.to);
    expect(blockFold).not.toBeNull();
    const closeDelimLine = state.doc.line(6);
    expect(blockFold?.to).toBe(closeDelimLine.to);
  });
});

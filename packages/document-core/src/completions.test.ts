import { expect, test } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { Analysis } from '@metis/contracts';
import { complete } from '../../../apps/desktop/src/renderer/widgets/document-workspace/completions';
const analysis: Analysis = { html: '', outline: [], diagnostics: [], relations: [], conditions: [], attributeUses: [],
  files: ['docs/main.adoc', 'shared/part.adoc'], anchors: [{ id: 'local', title: 'Local', relativePath: 'docs/main.adoc', line: 1 }],
  targetAnchors: [{ id: 'part', title: 'Part', relativePath: 'shared/part.adoc', documentPath: 'shared/part.adoc', line: 2 }],
  attributes: [{ name: 'edition', value: 'public', applied: true, relativePath: 'docs/main.adoc', line: 1 }] };
test.each([
  ['include::', '', '../shared/part.adoc', '../shared/part.adoc[]'],
  ['xref:../shared/', '[]', '../shared/part.adoc#part', '../shared/part.adoc#part'],
  ['<<lo', '>>', 'local', 'local'], ['{edi', '}', 'edition', 'edition'], ['{edi', '', 'edition', 'edition}'],
  ['include::{edi', '}[]', 'edition', 'edition']
])('completion preserves standard syntax and existing suffix: %s', (before, after, label, apply) => {
  const context = new CompletionContext(EditorState.create({ doc: before + after }), before.length, true);
  const result = complete(context, 'docs/main.adoc', analysis)!;
  expect(result.options.find(option => option.label === label)?.apply).toBe(apply);
  expect(result.from).toBe(before.length - (before.match(/\{([\w-]*)$/)?.[1].length ?? before.match(/(?:include::|xref:|<<)(.*)$/)?.[1].length ?? 0));
});

test('slash command completions trigger on / and provide AsciiDoc templates', () => {
  const contextSlash = new CompletionContext(EditorState.create({ doc: '/' }), 1, true);
  const resultSlash = complete(contextSlash, 'docs/main.adoc');
  expect(resultSlash).not.toBeNull();
  expect(resultSlash!.from).toBe(0);
  expect(resultSlash!.options.some(o => o.label === '/note')).toBe(true);
  expect(resultSlash!.options.some(o => o.label === '/table')).toBe(true);
  expect(resultSlash!.options.some(o => o.label === '/todo')).toBe(true);

  const contextNote = new CompletionContext(EditorState.create({ doc: '/not' }), 4, true);
  const resultNote = complete(contextNote, 'docs/main.adoc')!;
  const noteOpt = resultNote.options.find(o => o.label === '/note');
  expect(noteOpt?.apply).toBe('[NOTE]\n====\n\n====\n');
  expect(resultNote.from).toBe(0);

  const contextIndent = new CompletionContext(EditorState.create({ doc: '   /tip' }), 7, true);
  const resultIndent = complete(contextIndent, 'docs/main.adoc')!;
  expect(resultIndent.from).toBe(3);

  // Comments like // and URLs like http://... should NOT trigger slash commands
  const contextComment = new CompletionContext(EditorState.create({ doc: '//' }), 2, true);
  expect(complete(contextComment, 'docs/main.adoc')).toBeNull();

  const contextUrl = new CompletionContext(EditorState.create({ doc: 'https://example.com/' }), 20, true);
  expect(complete(contextUrl, 'docs/main.adoc')).toBeNull();
});

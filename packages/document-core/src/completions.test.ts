import { expect, test } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { Analysis } from '@metis/contracts';
import { complete } from '../../../apps/desktop/src/renderer/completions';
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

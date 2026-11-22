// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import type { Analysis } from '@metis/contracts';
import { alignPreviewToLine, previewElementAtLine } from './preview-position';

const analysis: Analysis = { html: '', outline: [{ id: 'section', title: 'Section', level: 1, relativePath: 'main.adoc', line: 3 }], diagnostics: [], anchors: [], targetAnchors: [], relations: [], attributes: [], attributeUses: [], conditions: [], files: [], previewLocations: [{ token: 'one', relativePath: 'main.adoc', line: 5 }, { token: 'two', relativePath: 'main.adoc', line: 12 }, { token: 'included', relativePath: 'part.adoc', line: 15 }] };
test('cursor maps to the nearest local paragraph or diagram rather than the section heading', () => {
  const doc = new DOMParser().parseFromString('<h2 id="section">Section</h2><p data-metis-source="one">One</p><p data-metis-source="two">Two</p><p data-metis-source="included">Included</p><div data-d2-path="main.adoc" data-d2-line="20">Diagram</div>', 'text/html');
  expect(previewElementAtLine(doc, analysis, 'main.adoc', 2)).toBeUndefined();
  expect(previewElementAtLine(doc, analysis, 'main.adoc', 4)?.id).toBe('section');
  expect(previewElementAtLine(doc, analysis, 'main.adoc', 9)?.textContent).toBe('One');
  expect(previewElementAtLine(doc, analysis, 'main.adoc', 19)?.textContent).toBe('Two');
  expect(previewElementAtLine(doc, analysis, 'main.adoc', 23)?.textContent).toBe('Diagram');
  expect(previewElementAtLine(doc, analysis, 'part.adoc', 16)?.textContent).toBe('Included');
});
test('alignment opens enclosing details and leaves editor focus unchanged', () => {
  document.body.innerHTML = '<textarea></textarea><details><p data-metis-source="two">Two</p></details>';
  const editor = document.querySelector('textarea')!; editor.focus();
  const paragraph = document.querySelector('p')!; paragraph.scrollIntoView = vi.fn();
  alignPreviewToLine(document, analysis, 'main.adoc', 13);
  expect(paragraph.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(document.querySelector('details')?.open).toBe(true); expect(document.activeElement).toBe(editor);
});

test('heading alignment matches outline navigation across preview remounts', () => {
  const doc = new DOMParser().parseFromString('<div class="sect1" data-metis-source="section"><h2 id="section">Section</h2><p>Body</p></div>', 'text/html');
  expect(previewElementAtLine(doc, { ...analysis, previewLocations: [{ token: 'section', relativePath: 'main.adoc', line: 3 }] }, 'main.adoc', 3)?.id).toBe('section');
});

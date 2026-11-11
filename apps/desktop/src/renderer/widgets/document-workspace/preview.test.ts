// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { safePreview } from './preview';
import { previewDestination } from './preview-links';
import { validate, type Relation } from '@metis/contracts';

test('web and resolved document links are separated from attachments and forged navigation is discarded', () => {
  const relations: Relation[] = [{ kind: 'xref', target: '../DB/index.adoc', relativePath: 'Notion/index.adoc', line: 5, state: 'resolved', destination: { relativePath: 'DB/index.adoc', line: 1 } }];
  const page = safePreview('<div><a href="https://www.notion.so/abc">원본</a><a href="../DB/index.html">DB</a><a href="#" data-web-url="https://evil.test" data-document-target="evil.adoc">위조</a><a href="javascript:alert(1)">차단</a></div>', undefined, undefined, [], relations);
  const doc = new DOMParser().parseFromString(page, 'text/html');
  expect(doc.body.innerHTML).toContain('data-web-url');
  expect(doc.querySelectorAll('[data-web-url]')).toHaveLength(1);
  expect(doc.querySelector('[data-web-url]')?.getAttribute('data-web-url')).toBe('https://www.notion.so/abc');
  expect(doc.querySelectorAll('[data-document-target]')).toHaveLength(1);
  expect(doc.body.textContent).not.toContain('첨부파일');
  expect(previewDestination('../DB/index.html', relations)).toEqual({ relativePath: 'DB/index.adoc', line: 1 });
  expect(previewDestination('../DB/index.html', [...relations, { ...relations[0], destination: { relativePath: 'other.adoc', line: 1 } }])).toBeUndefined();
});

test('browser IPC accepts scoped web links and rejects commands, credentials and stale request shapes', () => {
  const scope = { requestId: 'link', workspaceId: 'workspace', workspaceEpoch: 1 };
  expect(validate('openWebLink', { ...scope, url: 'https://www.notion.so/abc' })).toMatchObject(scope);
  for (const url of ['file:///C:/a.exe', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com/\nfoo', 'https://example.com\\foo']) expect(() => validate('openWebLink', { ...scope, url })).toThrow();
  expect(() => validate('openWebLink', { url: 'https://example.com' })).toThrow();
});

test('assembles local themes in precedence order and keeps scripts disabled', () => {
  const page = safePreview('<h1>Title</h1><script>alert(1)</script><div data-preview-asset="diagram-0"></div>', undefined, new Map([['diagram-0', { kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="diagram"/></svg>' }]]));
  expect(page).toContain("script-src 'none'");
  expect(page).not.toContain('alert(1)');
  expect(page).toContain('id="diagram"');
  expect(page.indexOf('data-theme="asciidoctor"')).toBeLessThan(page.indexOf('data-theme="highlight"'));
  expect(page.indexOf('data-theme="highlight"')).toBeLessThan(page.indexOf('data-theme="metis"'));
  expect(page).not.toMatch(/@import\s+["']https?:/i);
});

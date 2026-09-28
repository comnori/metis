// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { safePreview } from './preview';

test('assembles local themes in precedence order and keeps scripts disabled', () => {
  const page = safePreview('<h1>Title</h1><script>alert(1)</script><div data-mermaid-svg="diagram-0"></div>', undefined, new Map([['diagram-0', '<svg xmlns="http://www.w3.org/2000/svg"><rect id="diagram"/></svg>']]));
  expect(page).toContain("script-src 'none'");
  expect(page).not.toContain('alert(1)');
  expect(page).toContain('id="diagram"');
  expect(page.indexOf('data-theme="asciidoctor"')).toBeLessThan(page.indexOf('data-theme="highlight"'));
  expect(page.indexOf('data-theme="highlight"')).toBeLessThan(page.indexOf('data-theme="metis"'));
  expect(page).not.toMatch(/@import\s+["']https?:/i);
});

import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewStylesheets, validatePreviewCss } from './preview-stylesheet';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
describe('preview stylesheets', () => {
  it('stores a reference and rereads external changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-style-')); roots.push(root);
    const cssPath = path.join(root, 'theme.css'), store = new PreviewStylesheets(path.join(root, 'settings', 'styles.json'));
    await fs.writeFile(cssPath, 'body { color: red }');
    expect(await store.select('a'.repeat(64), cssPath)).toMatchObject({ name: 'theme.css', css: 'body { color: red }', active: true });
    await fs.writeFile(cssPath, 'body { color: blue }');
    expect((await store.read('a'.repeat(64))).css).toBe('body { color: blue }');
    await fs.unlink(cssPath); expect(await store.read('a'.repeat(64))).toMatchObject({ name: 'theme.css', active: false, warning: expect.any(String) });
    expect(await store.clear('a'.repeat(64))).toEqual({ active: false });
  });
  it('keeps invalid references but returns a safe fallback warning', async () => {
    expect(validatePreviewCss(Buffer.from('@import "https://example.test/x.css"'))).toMatchObject({ warning: expect.any(String) });
    expect(validatePreviewCss(Buffer.from('a{background:url(x)}'))).toMatchObject({ warning: expect.any(String) });
    expect(validatePreviewCss(Buffer.alloc(256 * 1024 + 1))).toMatchObject({ warning: expect.any(String) });
  });
});

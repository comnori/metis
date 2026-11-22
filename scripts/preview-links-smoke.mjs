import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `preview-links-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const sample = await readFile(path.join(root, 'samples/d2-demo.adoc'), 'utf8');
await writeFile(path.join(fixture, 'untitled3.adoc'), sample + '\n\n== 링크 검증\n\n<<_d2_서비스_구성,서비스 구성으로>>\n\n각주footnote:[각주 이동 예제]\n\n++++\n<p><a href="#">맨 위로</a> <a href="#missing-anchor">없는 위치</a></p>\n++++\n');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡untitled3.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const frame = page.locator('iframe[title="AsciiDoc 미리보기"]'), preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-d2-output').first().waitFor();
  const mermaid = preview.locator('.metis-mermaid-output svg').first();
  await mermaid.waitFor();
  const text = await mermaid.locator('text').allTextContents();
  for (const label of ['AsciiDoc 작성', '문서 해석', '활성 확장', 'Mermaid', 'D2', '미리보기']) assert.ok(text.some(value => value.includes(label)), `Missing Mermaid label: ${label}`);
  assert.equal(await mermaid.locator('foreignObject').count(), 0);
  assert.ok(await mermaid.locator('text').evaluateAll(elements => elements.every(element => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.fill !== 'none' && style.opacity !== '0';
  })));
  await mermaid.screenshot({ path: path.join(run, 'mermaid-labels.png') });
  const firstDiagram = preview.locator('.metis-d2-output').first();
  assert.equal(await firstDiagram.locator('summary').count(), 0);
  const download = firstDiagram.getByRole('button', { name: '다이어그램 다운로드', exact: true });
  const menu = firstDiagram.getByRole('menu');
  await download.click();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['SVG벡터 이미지', 'PNG이미지', 'PDF문서']);
  await firstDiagram.screenshot({ path: path.join(run, 'diagram-download-menu.png') });
  await page.keyboard.press('ArrowDown');
  assert.equal(await frame.evaluate(f => f.contentDocument.activeElement.dataset.d2Export), 'png');
  await page.keyboard.press('Escape');
  assert.equal(await download.getAttribute('aria-expanded'), 'false');
  await download.focus(); await page.keyboard.press('Enter');
  assert.equal(await download.getAttribute('aria-expanded'), 'true');
  await firstDiagram.locator('.metis-d2-diagram').click();
  assert.equal(await download.getAttribute('aria-expanded'), 'false');
  const tocLink = preview.locator('#toc a').filter({ hasText: 'D2: 서비스 구성' });
  const href = await tocLink.getAttribute('href'); assert.ok(href?.startsWith('#'));
  const before = await frame.evaluate(f => ({ url: f.contentWindow.location.href, content: f.contentDocument.body.textContent, svg: f.contentDocument.querySelectorAll('svg').length }));
  await tocLink.click();
  await page.waitForFunction(id => {
    const doc = document.querySelector('iframe[title="AsciiDoc 미리보기"]')?.contentDocument;
    return doc?.getElementById(id)?.getBoundingClientRect().top < 5;
  }, href.slice(1), { timeout: 5000 });
  const after = await frame.evaluate(f => ({ url: f.contentWindow.location.href, content: f.contentDocument.body.textContent, svg: f.contentDocument.querySelectorAll('svg').length, y: f.contentWindow.scrollY }));
  assert.equal(after.url, before.url); assert.equal(after.content, before.content); assert.equal(after.svg, before.svg); assert.ok(after.y > 0);
  await preview.locator('a[href="#missing-anchor"]').click();
  assert.equal(await frame.evaluate(f => f.contentWindow.location.href), before.url);
  await preview.locator('a[href="#"]').filter({ hasText: '맨 위로' }).click();
  assert.equal(await frame.evaluate(f => f.contentWindow.scrollY), 0);
  await tocLink.focus(); await page.keyboard.press('Enter');
  assert.equal(await frame.evaluate(f => f.contentWindow.location.href), before.url);
  await preview.locator('a[href="#_footnotedef_1"]').click();
  await preview.locator('a[href="#_footnoteref_1"]').click();
  assert.equal(await frame.evaluate(f => f.contentWindow.location.href), before.url);
  await preview.locator('a[data-d2-board-link]').first().click();
  assert.equal(await preview.locator('details[data-d2-board="layers.detail"]').getAttribute('open'), '');
  assert.equal(await frame.evaluate(f => f.contentWindow.location.href), before.url);
  await page.screenshot({ path: path.join(run, 'preview-links.png') });
  console.log(JSON.stringify({ run, checks: ['six Korean Mermaid labels remain visible SVG text', 'root disclosure removed; icon download menu with keyboard and outside-dismiss', 'sample table of contents scrolls without navigation or content loss', 'keyboard activation, missing anchor and top link', 'footnote and backlink', 'D2 board links remain functional'] }, null, 2));
} catch (error) {
  if (page) {
    console.log(await page.locator('iframe[title="AsciiDoc 미리보기"]').evaluate(f => ({ url: f.contentWindow.location.href, text: f.contentDocument.body?.textContent?.slice(0, 300) })).catch(e => ({ error: e.message })));
    await page.screenshot({ path: path.join(run, 'failed.png') }).catch(() => {});
  }
  throw error;
} finally { await app.close(); }

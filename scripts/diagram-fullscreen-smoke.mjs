import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `diagram-fullscreen-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, 'note.adoc'), '= Fullscreen diagrams\n\n[mermaid]\n----\nflowchart LR\n A[시작] --> B[전체 화면 확인]\n----\n\n[d2]\n----\ndirection: right\nclient: Client { link: https://example.com }\nnotes: |md\n # D2 Markdown\n **Fullscreen label**\n|\nclient -> notes: Request\nlayers: { detail: { db: Database { shape: cylinder } } }\n----\n\n== Body\n\n' + 'A paragraph below the diagrams.\n\n'.repeat(40));
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog, shell }, fixture) => {
    BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1;
    globalThis.fullscreenExternalLinks = []; shell.openExternal = async url => { globalThis.fullscreenExternalLinks.push(url); };
  }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '분할', exact: true }).click();
  const frame = page.locator('iframe[title="AsciiDoc 미리보기"]'), preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  const modal = page.locator('dialog.diagram-fullscreen');
  const viewer = page.frameLocator('dialog.diagram-fullscreen iframe');
  const viewport = viewer.getByRole('group', { name: '다이어그램 이동 영역', exact: true });
  const transform = () => viewport.locator(':scope>svg').evaluate(svg => svg.style.transform);
  const sections = [preview.locator('.metis-mermaid'), preview.locator('[data-d2-board="root"]')];
  await sections[1].getByRole('button', { name: '다이어그램 전체 화면', exact: true }).waitFor();
  await frame.evaluate(frame => { frame.dataset.stable = 'yes'; });
  for (const [index, section] of sections.entries()) {
    await section.getByRole('button', { name: '다이어그램 확대', exact: true }).click();
    const area = section.getByRole('group', { name: '다이어그램 이동 영역', exact: true });
    await area.scrollIntoViewIfNeeded();
    const original = await area.locator(':scope>svg').evaluate(svg => svg.outerHTML);
    const scroll = await frame.evaluate(frame => frame.contentWindow.scrollY);
    if (index === 1) await section.locator('a[data-web-url]').dblclick();
    else await area.dblclick();
    await modal.waitFor(); await viewport.waitFor();
    assert.equal(await modal.getAttribute('aria-labelledby') !== null, true);
    const bounds = await modal.boundingBox(), windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1 && Math.abs(bounds.width - windowSize.width) < 2 && Math.abs(bounds.height - windowSize.height) < 2);
    assert.equal(await transform(), 'translate(0px, 0px) scale(1)');
    await viewer.getByText(index === 0 ? '전체 화면 확인' : 'Fullscreen label', { exact: true }).waitFor();
    const rect = await viewport.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => document.querySelector('dialog iframe')?.contentDocument.querySelector('output')?.textContent === '127%');
    const beforeDrag = await viewport.locator(':scope>svg').evaluate(svg => { const value = new DOMMatrix(getComputedStyle(svg).transform); return { x: value.e, y: value.f }; });
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    const afterDrag = await viewport.locator(':scope>svg').evaluate(svg => { const value = new DOMMatrix(getComputedStyle(svg).transform); return { x: value.e, y: value.f }; });
    assert.ok(Math.abs(afterDrag.x - beforeDrag.x - 60) < 1 && Math.abs(afterDrag.y - beforeDrag.y - 30) < 1, JSON.stringify({ beforeDrag, afterDrag }));
    await viewport.focus(); await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs(await viewport.locator(':scope>svg').evaluate(svg => new DOMMatrix(getComputedStyle(svg).transform).e) - afterDrag.x - 30) < 1);
    await viewer.getByRole('button', { name: '다이어그램 화면에 맞춤', exact: true }).click(); assert.equal(await transform(), 'translate(0px, 0px) scale(1)');
    await page.screenshot({ path: path.join(run, `${index ? 'd2' : 'mermaid'}-fullscreen.png`) });
    await viewer.getByRole('button', { name: '다이어그램 확대', exact: true }).focus();
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
    assert.equal(await frame.getAttribute('data-stable'), 'yes'); assert.equal(await frame.evaluate(frame => frame.contentWindow.scrollY), scroll);
    assert.equal(await area.locator(':scope>svg').evaluate(svg => svg.outerHTML), original);
    await page.waitForFunction(() => document.querySelector('iframe[title="AsciiDoc 미리보기"]')?.contentDocument.activeElement?.classList.contains('metis-diagram-viewport'));
  }
  assert.deepEqual(await app.evaluate(() => globalThis.fullscreenExternalLinks), []);
  await preview.locator('details[data-d2-board]>summary').click();
  const detail = preview.locator('details[data-d2-board]');
  await detail.getByRole('button', { name: '다이어그램 전체 화면', exact: true }).click(); await viewport.waitFor();
  await viewer.getByText('Database', { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  await page.waitForFunction(() => { const dialog = document.querySelector('dialog.diagram-fullscreen'); return dialog && Math.abs(dialog.getBoundingClientRect().width - innerWidth) < 2; });
  const size = await viewport.boundingBox(); assert.ok(size.width > 850 && size.height > 350);
  await modal.getByRole('button', { name: 'D2 다이어그램 전체 화면 닫기', exact: true }).click(); await modal.waitFor({ state: 'detached' });
  await detail.getByRole('group', { name: '다이어그램 이동 영역', exact: true }).focus(); await page.keyboard.press('Enter'); await modal.waitFor();
  await modal.getByRole('button', { name: 'D2 다이어그램 전체 화면 닫기', exact: true }).focus(); await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ run, checks: ['double-click Mermaid and linked D2 shapes', 'modal covers entire app window', 'wheel zoom, drag, keyboard and fit', 'D2 Markdown and collapsed boards', 'Escape from frame buttons and modal header; close button', 'restored preview focus, scroll and SVG view state', 'responsive fit after window resize', 'keyboard and toolbar entry points'] }, null, 2));
} catch (error) {
  console.error(error); if (page) { console.error((await page.locator('body').innerText()).slice(-2500)); await page.screenshot({ path: path.join(run, 'failed.png') }).catch(() => {}); }
  throw error;
} finally { await app.close(); }

import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `ux-02-response-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '= Response fixture\n\n' + Array.from({ length: 800 }, (_, i) => `== Section ${i}\n\n${'Long source content for response measurement. '.repeat(25)}\n\n`).join('');
await writeFile(path.join(fixture, 'long.adoc'), original);
for (let i = 0; i < 400; i++) await writeFile(path.join(fixture, `search-${i}.adoc`), `= Document ${i}\n\nresponse-needle-${i}\n`);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], samples = [];
let escapeObservation;
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1180, 800); win.showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click(); await page.getByRole('button', { name: '≡long.adoc', exact: true }).click();
  await page.getByRole('button', { name: '분할', exact: true }).click();
  await page.locator('.outline .operation-status[data-phase="complete"]').waitFor();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  for (let i = 0; i < 10; i++) {
    await editor.focus(); await page.keyboard.press('ControlOrMeta+End');
    const marker = `Response marker ${i}`, started = performance.now();
    await page.keyboard.insertText(`\n\n${marker}`);
    await page.waitForFunction(marker => document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent?.includes(marker), marker);
    const inputMs = performance.now() - started;
    assert.ok((await editor.textContent()).includes(marker));
    await page.frameLocator('iframe').getByText(marker, { exact: true }).waitFor({ state: 'attached' });
    const previewMs = performance.now() - started;
    await page.getByRole('button', { name: '검색', exact: true }).click();
    const search = page.getByRole('dialog', { name: '작업 공간 검색' }), searchStarted = performance.now();
    await search.getByRole('searchbox').fill(`response-needle-${i}`);
    await search.locator('.search-result').filter({ hasText: `response-needle-${i}` }).first().waitFor();
    await search.locator('.operation-status[data-phase="complete"],.operation-status[data-phase="partial"]').waitFor();
    const searchMs = performance.now() - searchStarted, hits = await search.locator('.search-result').count();
    assert.ok(hits > 0); assert.equal(await search.locator('[data-phase="partial"]').count(), 0); samples.push({ iteration: i + 1, inputMs, previewMs, searchMs, hits, partial: await search.locator('[data-phase="partial"]').count() > 0 });
    if (i === 0) {
      await page.keyboard.press('Escape');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const dialogOpen = await search.isVisible();
      escapeObservation = { dialogOpen, queryAfterEscape: dialogOpen ? await search.getByRole('searchbox').inputValue() : null };
    }
    if (await search.isVisible()) await search.getByRole('button', { name: '검색 닫기', exact: true }).click();
    await search.waitFor({ state: 'detached' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  assert.equal(await readFile(path.join(fixture, 'long.adoc'), 'utf8'), original);
  const distribution = key => { const values = samples.map(s => s[key]).sort((a, b) => a - b); return { min: values[0], median: (values[4] + values[5]) / 2, max: values[9] }; };
  const result = { platform: process.platform, release: os.release(), node: process.version, executable: packaged ?? 'development', packaged: !!packaged, documents: 401, sections: 800, iterations: 10, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), viewport: { width: 1180, height: 800, zoom: 1 }, sourceBytes: Buffer.byteLength(original), samples, escapeObservation, milliseconds: { input: distribution('inputMs'), preview: distribution('previewMs'), search: distribution('searchMs') }, sourceUnchanged: true, note: 'Ten sequential synthetic UI observations including Playwright/IPC/debounce overhead. Compare identical fixtures on the same host; not human task time or a long-session guarantee.' };
  await writeFile(path.join(run, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ run, ...result }, null, 2));
} catch (error) { await writeFile(path.join(run, 'failure.json'), JSON.stringify({ samples, error: String(error) }, null, 2)); throw error; }
finally { await app.close(); }

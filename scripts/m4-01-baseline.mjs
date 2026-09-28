import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m4-01-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(path.join(fixture, 'shared'), { recursive: true });
const source = '= UX baseline\n\n== Overview\n\ninclude::shared/part.adoc[]\n\n== Follow-up\n\nxref:shared/part.adoc[]\n';
await writeFile(path.join(fixture, 'guide.adoc'), source); await writeFile(path.join(fixture, 'shared/part.adoc'), '== Reused section\n\nShared source text.');
const packaged = process.argv[2], env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
const measurements = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click(); await page.getByRole('button', { name: '≡guide.adoc', exact: true }).click();
  await page.locator('.outline-item').filter({ hasText: 'Reused section' }).waitFor();
  for (const [width, height, zoom] of [[1180, 800, 1], [800, 600, 1], [1180, 800, 2]]) {
    await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(size[0], size[1]); win.webContents.setZoomFactor(size[2]); }, [width, height, zoom]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => {
      const rect = selector => { const e = document.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const header = document.querySelector('header').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('header button, header summary')].filter(e => e.checkVisibility());
      return { viewport: { width: innerWidth, height: innerHeight }, header: rect('header'), sidebar: rect('aside'), editor: rect('.editor-panel:not([hidden]) .source'), headerButtons: buttons.length,
        headerButtonsOutsideHeader: buttons.filter(e => { const r = e.getBoundingClientRect(); return r.top < header.top || r.bottom > header.bottom || r.right > header.right || r.left < header.left; }).map(e => e.textContent),
        pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    const screenshot = `layout-${width}-${height}-${zoom}.png`;
    const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    await writeFile(path.join(run, screenshot), Buffer.from(capture, 'base64'));
    measurements.push({ contentSize: { width, height }, zoom, ...metrics, screenshot });
  }
  assert.equal(await readFile(path.join(fixture, 'guide.adoc'), 'utf8'), source);
  await writeFile(path.join(run, 'results.json'), JSON.stringify({ platform: process.platform, release: os.release(), packaged: !!packaged, executable: packaged ?? 'development', measurements, sourceUnchanged: true, note: 'Geometry observations, not usability scores or human task timings.' }, null, 2));
  console.log(JSON.stringify({ run, measurements }, null, 2));
} finally { await app.close(); }

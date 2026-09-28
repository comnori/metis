import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const executable = process.argv[2];
if (!executable) throw Error('Pass a packaged executable; no development fallback.');
const minutes = Number(process.argv[3] ?? 5), cycles = Number(process.argv[4] ?? 30);
if (process.argv.length > 5 || !Number.isInteger(minutes) || minutes < 1 || minutes > 120 || !Number.isInteger(cycles) || cycles < 12 || cycles > 3600) throw Error('Usage: executable [minutes:1..120] [cycles:12..3600]');
const durationMs = minutes * 60000;
const run = path.join(root, '.pre04-runs', `ux-02-session-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const originals = new Map();
for (let i = 0; i < 12; i++) {
  const name = `note-${String(i).padStart(2, '0')}.adoc`;
  const source = `= Session ${i}\n\n` + Array.from({ length: 40 }, (_, j) => `== Section ${j}\n\n${'Session editing text. '.repeat(40)}\n\n`).join('');
  originals.set(name, source); await writeFile(path.join(fixture, name), source);
}
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const samples = [], started = Date.now();
const report = { executable, platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, tabs: 12, minimumDurationMs: durationMs, cycles, thresholds: { heapGrowthMiB: 128, lateVsEarlyMedianMiB: 64, privateGrowthMiB: 256 }, samples, status: 'running' };
const save = () => writeFile(path.join(run, 'results.json'), JSON.stringify(report, null, 2));
await save(); console.log(`Session report: ${run}`);
let page;
const app = await electron.launch({ executablePath: executable, args: ['--smoke'], env });
try {
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1180, 800); win.showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  const ready = () => page.locator('.outline .operation-status[data-phase="complete"]').waitFor();
  for (const name of originals.keys()) {
    await page.getByRole('button', { name: `≡${name}`, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await editor.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(`\nDRAFT-${name}`); await ready();
  }
  assert.deepEqual(await page.getByRole('tab').allTextContents(), [...originals.keys()].map(name => name + ' ●'));
  await page.getByRole('button', { name: '분할', exact: true }).click();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  async function sample(cycle) {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
    const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ pid: p.pid, creationTime: p.creationTime, type: p.type, name: p.name, serviceName: p.serviceName, memoryKiB: p.memory })));
    const privateMiB = processes.every(p => Number.isFinite(p.memoryKiB.privateBytes)) ? processes.reduce((sum,p) => sum + p.memoryKiB.privateBytes, 0) / 1024 : null;
    samples.push({ processes, privateMiB, workingSetMiBSum: processes.reduce((sum,p) => sum + p.memoryKiB.workingSetSize, 0) / 1024, cycle, elapsedMs: Date.now() - started, heapUsedMiB: m.JSHeapUsedSize / 1048576, heapTotalMiB: m.JSHeapTotalSize / 1048576, documents: m.Documents, nodes: m.Nodes });
    await save();
  }
  await sample(0);
  const names = [...originals.keys()], measuredStart = Date.now();
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const name = names[(cycle - 1) % names.length], other = names[cycle % names.length];
    await page.getByRole('tab', { name: `${name} ●`, exact: true }).click(); await ready();
    await editor.focus(); await page.keyboard.press('ControlOrMeta+End');
    assert.ok((await editor.textContent()).includes(`DRAFT-${name}`));
    await page.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('tab', { name: `${other} ●`, exact: true }).click(); await ready();
    await page.getByRole('tab', { name: `${name} ●`, exact: true }).click(); await ready();
    await editor.focus(); await page.keyboard.insertText('X');
    assert.ok((await editor.textContent()).includes(`DRAFT-${name.slice(0, -1)}X`), 'selection survives tab round trip');
    await page.keyboard.press('ControlOrMeta+z'); await ready();
    assert.ok((await editor.textContent()).includes(`DRAFT-${name}`));
    await page.locator('.outline-item').filter({ hasText: /^Section 20/ }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.scrollY > 1000);
    const y = await page.locator('iframe').evaluate(f => f.contentWindow.scrollY);
    await page.getByRole('button', { name: '원문', exact: true }).click(); await page.getByRole('button', { name: '분할', exact: true }).click();
    assert.ok(Math.abs(await page.locator('iframe').evaluate(f => f.contentWindow.scrollY) - y) < 3);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, measuredStart + cycle * durationMs / cycles - Date.now())));
    await sample(cycle);
    if (cycle % Math.max(1, Math.floor(cycles / minutes)) === 0) console.log(`Completed ${cycle}/${cycles} cycles`);
  }
  // Fill beyond the cap, then inspect public command availability while draining it.
  for (let i = 0; i < 105; i++) {
    const name = names[i % names.length];
    await page.getByRole('tab', { name: name + ' ●', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
  }
  let historySteps = 0;
  for (; historySteps <= 100; historySteps++) {
    await page.getByRole('button', { name: '명령 팔레트', exact: true }).click();
    const palette = page.getByRole('dialog', { name: '명령 팔레트' });
    await palette.getByRole('combobox').fill('탐색 뒤로');
    const option = palette.getByRole('option').filter({ hasText: '탐색 뒤로' });
    if (await option.getAttribute('aria-disabled') === 'true') { await page.keyboard.press('Escape'); break; }
    await palette.getByRole('combobox').press('Enter'); await palette.waitFor({ state: 'detached' });
  }
  assert.equal(historySteps, 100, 'navigation retains exactly 100 back entries');
  await uiCommand(page, '탐색 앞으로');
  report.historyBackSteps = historySteps;
  await sample('after-history');
  for (const [name, source] of originals) assert.equal(await readFile(path.join(fixture, name), 'utf8'), source);
  const median = values => { values.sort((a,b) => a-b); const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; };
  const sessionSamples = samples.filter(s => typeof s.cycle === 'number');
  report.privateGrowthMiB = sessionSamples.every(s => s.privateMiB !== null) ? sessionSamples.at(-1).privateMiB - sessionSamples[0].privateMiB : null;
  if (process.platform === 'win32') { assert.notEqual(report.privateGrowthMiB, null); assert.ok(report.privateGrowthMiB <= 256, 'private process memory growth'); }
  report.heapGrowthMiB = sessionSamples.at(-1).heapUsedMiB - samples[0].heapUsedMiB;
  report.lateVsEarlyMedianMiB = median(sessionSamples.slice(-6).map(s=>s.heapUsedMiB)) - median(sessionSamples.slice(1,7).map(s=>s.heapUsedMiB));
  report.measuredDurationMs = sessionSamples.at(-1).elapsedMs - sessionSamples[0].elapsedMs;
  report.withHistoryDurationMs = Date.now() - measuredStart;
  assert.ok(report.heapGrowthMiB <= 128, 'heap growth threshold'); assert.ok(report.lateVsEarlyMedianMiB <= 64, 'late heap median threshold');
  report.sourceUnchanged = true; report.draftSelectionAndPositionPreserved = true; report.status = 'passed'; await save();
  console.log(JSON.stringify({ run, status: report.status, heapGrowthMiB: report.heapGrowthMiB, lateVsEarlyMedianMiB: report.lateVsEarlyMedianMiB, measuredDurationMs: report.measuredDurationMs }));
} catch (error) { report.tabsAtFailure = await page?.getByRole('tab').allTextContents().catch(() => []); report.status = 'failed'; report.error = String(error); await save(); throw error; }
finally { await app.close(); }



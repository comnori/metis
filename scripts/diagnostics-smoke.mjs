import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `diagnostics-${Date.now()}`);
await mkdir(run, { recursive: true });
const preload = path.join(run, 'broken-preload.cjs');
await writeFile(preload, 'throw new Error("diagnostics smoke preload failure");');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const instance = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
let ids;
try {
  const page = await instance.firstWindow();
  await page.getByRole('heading', { name: '문서가 있는 곳에서 시작하세요.' }).waitFor();
  ids = await instance.evaluate(async ({ BrowserWindow }, { preload, missing }) => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      const preloadError = new Promise(resolve => window.webContents.once('preload-error', () => resolve()));
      await window.loadURL('data:text/html,<h1>private-diagnostics-document</h1>');
      await preloadError;
      await window.loadFile(missing).catch(() => {});
      await window.loadURL('about:blank');
      const webContentsId = window.webContents.id, rendererPid = window.webContents.getOSProcessId();
      const gone = new Promise(resolve => window.webContents.once('render-process-gone', (_event, details) => resolve(details)));
      window.webContents.forcefullyCrashRenderer();
      const details = await gone;
      return { webContentsId, rendererPid, details };
    } finally { window.destroy(); }
  }, { preload, missing: path.join(run, 'missing.html') });
} finally { await instance.close(); }
const logPath = path.join(run, 'profile', 'logs', 'diagnostics.jsonl');
const text = await readFile(logPath, 'utf8');
const lines = text.trim().split('\n').map(line => JSON.parse(line));
assert(lines.some(line => line.event === 'app-start' && line.details.electron));
assert(lines.some(line => line.event === 'preload-error' && line.details.error.message.includes('diagnostics smoke preload failure')));
assert(lines.some(line => line.event === 'did-fail-load' && line.details.errorCode === -6 && line.details.isMainFrame));
assert(lines.some(line => line.event === 'render-process-gone' && line.details.webContentsId === ids.webContentsId && line.details.rendererPid === ids.rendererPid && line.details.reason === ids.details.reason));
assert(lines.some(line => line.event === 'app-quit' && line.details.exitCode === 0));
assert(!text.includes('private-diagnostics-document'));
const checks = ['startup metadata', 'actual sandbox preload error', 'actual missing page', 'actual renderer crash and PID', 'clean exit', 'inline document redaction'];
await writeFile(path.join(run, 'results.json'), JSON.stringify({ checks, logPath, ids }, null, 2));
console.log(JSON.stringify({ run, checks }, null, 2));

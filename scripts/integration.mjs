import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { latestExecutable, runLogged } from './integration-support.mjs';
const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `integration-${Date.now()}`);
await mkdir(run, { recursive: true });
const results = [];
const report = { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, commit: process.env.GITHUB_SHA ?? null, packaged: !!process.argv[2], status: 'running', results };
const save = () => writeFile(path.join(run, 'results.json'), JSON.stringify(report, null, 2));
let executable;
try {
  if (process.argv.length > 3 || (process.argv[2]?.startsWith('--') && process.argv[2] !== '--packaged')) throw new Error('Usage: node scripts/integration.mjs [--packaged | executable-path]');
  executable = process.argv[2] === '--packaged' ? await latestExecutable(root) : process.argv[2];
} catch (error) {
  report.status = 'failed'; report.error = error.message; await save(); console.error(error.message); process.exitCode = 1;
}
if (process.exitCode) { console.log(`Integration report: ${run}`); } else {
await save();
for (const name of ['smoke', ...Array.from({ length: 8 }, (_, i) => `m1-0${i + 1}-smoke`), 'm2-01-smoke', 'm2-02-smoke', 'm2-03-smoke', 'm2-04-smoke', 'm2-05-smoke', 'm2-06-smoke', 'm2-07-smoke', 'm3-01-smoke', 'm3-02-smoke', 'm3-03-smoke', 'm3-04-smoke', 'm3-04-ai-smoke', 'm3-05-smoke', 'm3-06-smoke', 'm3-07-smoke', 'm4-02-smoke', 'm4-03-smoke', 'm4-04-smoke', 'm4-05-smoke', 'm4-06-smoke', 'm4-07-smoke', 'ux-escape-smoke']) {
  const started = Date.now();
  report.activeSuite = name; await save();
  const result = await runLogged(process.execPath, [path.join(root, 'scripts', `${name}.mjs`), ...(executable ? [executable] : [])], { cwd: root, logPath: path.join(run, `${name}.log`) });
  results.push({ name, ...result, elapsedMs: Date.now() - started });
  delete report.activeSuite;
  if (result.code !== 0 || result.error) { report.status = 'failed'; process.exitCode = 1; await save(); break; }
  await save();
}
if (!process.exitCode) { report.status = 'passed'; await save(); }
console.log(`Integration report: ${run}`);
}

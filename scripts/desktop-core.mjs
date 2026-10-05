import { mkdir, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runLogged } from './integration-support.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `core-${Date.now()}`);
await mkdir(run, { recursive: true });
const result = await runLogged(process.execPath, [path.join(root, 'scripts/desktop-core-smoke.mjs'), run, ...process.argv.slice(2)], { cwd: root, logPath: path.join(run, 'core.log') });
if (result.code !== 0 || result.error) {
  await access(path.join(run, 'results.json')).catch(() => writeFile(path.join(run, 'results.json'), JSON.stringify({ status: 'failed', stage: 'launch', ...result }, null, 2)));
  process.exitCode = 1;
}
console.log(`Core report: ${run}`);

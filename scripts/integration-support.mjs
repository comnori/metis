import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export function packageRelativePath(platform, arch) {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported package target: ${platform}/${arch}`);
  const executable = platform === 'win32' ? 'Metis.exe' : platform === 'darwin' ? 'Metis.app/Contents/MacOS/Metis' : 'Metis';
  return `out/Metis-${platform}-${arch}/${executable}`;
}

export async function latestExecutable(root, platform = process.platform, arch = process.arch) {
  const runs = path.resolve(root, '.pre04-runs');
  const stage = path.resolve((await readFile(path.join(runs, 'latest-package.txt'), 'utf8')).trim());
  if (path.dirname(stage) !== runs || !/^package-\d+$/.test(path.basename(stage))) throw new Error('Package marker is outside the package staging directory. Run npm run package again.');
  const executable = path.join(stage, packageRelativePath(platform, arch));
  const actualStage = await realpath(stage), actualExecutable = await realpath(executable);
  const relative = path.relative(actualStage, actualExecutable);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(actualExecutable)).isFile()) throw new Error('Invalid packaged executable. Run npm run package again.');
  return actualExecutable;
}

// Capture both output streams, including launch failures, before reporting completion.
export async function runLogged(command, args, { cwd, logPath, echo = true }) {
  const log = createWriteStream(logPath);
  const written = finished(log);
  let logError;
  void written.catch(error => { logError = error.message; });
  const result = await new Promise(resolve => {
    let error;
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); if (echo) process.stdout.write(data); });
    child.on('error', failure => { error = failure.message; log.write(`${error}\n`); });
    child.on('close', (code, signal) => resolve({ code, signal, ...(error ? { error } : {}) }));
  });
  log.end();
  await written.catch(() => {});
  return logError ? { ...result, error: logError } : result;
}

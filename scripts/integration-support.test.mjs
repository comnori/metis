import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { packageRelativePath, latestExecutable, runLogged } from './integration-support.mjs';
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'metis-integration-test ')));
  t.after(async () => {
    if (path.dirname(root) !== await realpath(os.tmpdir()) || !path.basename(root).startsWith('metis-integration-')) throw Error('Cleanup boundary');
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, '.pre04-runs'));
  return root;
}
test('platform and architecture select the native executable', () => {
  assert.equal(packageRelativePath('win32', 'x64'), 'out/Metis-win32-x64/Metis.exe');
  assert.equal(packageRelativePath('darwin', 'arm64'), 'out/Metis-darwin-arm64/Metis.app/Contents/MacOS/Metis');
  assert.equal(packageRelativePath('linux', 'x64'), 'out/Metis-linux-x64/Metis');
  assert.throws(() => packageRelativePath('unknown', 'x64'));
  assert.throws(() => packageRelativePath('linux', '../x64'));
});
test('missing package marker fails instead of falling back to development', async t => {
  await assert.rejects(latestExecutable(await fixture(t)), { code: 'ENOENT' });
});
test('all native layouts resolve with spaces and a newline in the marker', async t => {
  const root = await fixture(t), stage = path.join(root, '.pre04-runs', 'package-123');
  await mkdir(stage);
  await writeFile(path.join(root, '.pre04-runs', 'latest-package.txt'), `${stage}\n`);
  for (const platform of ['win32', 'darwin', 'linux']) for (const arch of ['x64', 'arm64']) {
    const executable = path.join(stage, packageRelativePath(platform, arch));
    await mkdir(path.dirname(executable), { recursive: true }); await writeFile(executable, 'fixture');
    assert.equal(await latestExecutable(root, platform, arch), await realpath(executable));
  }
});
test('stale package and out-of-staging marker fail closed', async t => {
  const root = await fixture(t), marker = path.join(root, '.pre04-runs', 'latest-package.txt');
  await writeFile(marker, root);
  await assert.rejects(latestExecutable(root), /outside/);
  await writeFile(marker, path.join(root, '.pre04-runs', 'package-456'));
  await assert.rejects(latestExecutable(root), { code: 'ENOENT' });
});
test('failed suite retains both output streams and exit code', async t => {
  const root = await fixture(t), logPath = path.join(root, 'failure.log');
  const result = await runLogged(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exitCode=7'], { cwd: root, logPath, echo: false });
  assert.equal(result.code, 7); assert.equal(result.signal, null);
  assert.match(await readFile(logPath, 'utf8'), /out/); assert.match(await readFile(logPath, 'utf8'), /err/);
});
test('launch failure is captured as a failed result and log', async t => {
  const root = await fixture(t), logPath = path.join(root, 'launch.log');
  const result = await runLogged(path.join(root, 'missing-command'), [], { cwd: root, logPath, echo: false });
  assert.notEqual(result.code, 0); assert.match(result.error, /ENOENT/);
  assert.match(await readFile(logPath, 'utf8'), /ENOENT/);
});
test('log write failure cannot produce a passing result', async t => {
  const root = await fixture(t);
  const result = await runLogged(process.execPath, ['-e', 'console.log("test")'], { cwd: root, logPath: path.join(root, 'absent', 'log'), echo: false });
  assert.ok(result.error);
});

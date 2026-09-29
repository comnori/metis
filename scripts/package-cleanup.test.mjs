import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupPackages } from './package-cleanup.mjs';

test('retains latest two packages and unrelated evidence', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metis-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = path.join(root, '.pre04-runs');
  for (const name of ['package-9', 'package-10', 'package-11', 'smoke-1', 'package-not-a-run']) {
    await mkdir(path.join(runs, name), { recursive: true });
    await writeFile(path.join(runs, name, 'evidence.txt'), 'test');
  }
  await writeFile(path.join(runs, 'latest-package.txt'), path.join(runs, 'package-11'));
  await assert.rejects(cleanupPackages(root, path.join(root, 'package-11')), /Invalid current/);
  assert.ok((await readdir(runs)).includes('package-9'));
  await cleanupPackages(root, path.join(runs, 'package-11'));
  assert.deepEqual((await readdir(runs)).sort(), ['latest-package.txt', 'package-10', 'package-11', 'package-not-a-run', 'smoke-1']);
});

test('root aliases work while linked staging directories are rejected', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'metis-cleanup-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'actual'), alias = path.join(parent, 'alias');
  const runs = path.join(root, '.pre04-runs');
  for (const name of ['package-1', 'package-2', 'package-3']) await mkdir(path.join(runs, name), { recursive: true });
  await symlink(root, alias, 'junction');
  await cleanupPackages(alias, path.join(alias, '.pre04-runs', 'package-3'));
  assert.deepEqual((await readdir(runs)).sort(), ['package-2', 'package-3']);
  const linkedRoot = path.join(parent, 'linked');
  await mkdir(linkedRoot);
  await symlink(runs, path.join(linkedRoot, '.pre04-runs'), 'junction');
  await assert.rejects(cleanupPackages(linkedRoot, path.join(linkedRoot, '.pre04-runs', 'package-3')), /link/);
});

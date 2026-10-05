import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, access, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cacheNames, cleanupTestCache, withTestCacheCleanup } from './test-cache-cleanup.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'metis-cache-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = path.join(root, '.pre04-runs', 'smoke-123', 'profile');
  for (const name of [...cacheNames, 'recovery', 'Local Storage']) {
    await mkdir(path.join(profile, name), { recursive: true });
    await writeFile(path.join(profile, name, 'data'), 'preserve');
  }
  await writeFile(path.join(profile, '..', 'results.json'), '{}');
  return { root, profile };
}

test('only regenerable caches are removed; repeated cleanup is safe', async t => {
  const { root, profile } = await fixture(t);
  await cleanupTestCache(root, profile);
  await cleanupTestCache(root, profile);
  for (const name of cacheNames) await assert.rejects(access(path.join(profile, name)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(profile, 'recovery', 'data'), 'utf8'), 'preserve');
  await access(path.join(profile, 'Local Storage', 'data'));
  await access(path.join(profile, '..', 'results.json'));
  await assert.rejects(cleanupTestCache(root, path.join(root, 'profile')), /outside/);
});

test('linked profiles cannot redirect cleanup', async t => {
  const { root, profile } = await fixture(t);
  const linked = path.join(root, '.pre04-runs', 'smoke-456');
  await symlink(path.dirname(profile), linked, 'junction');
  await assert.rejects(cleanupTestCache(root, path.join(linked, 'profile')), /linked/);
  await access(path.join(profile, 'Cache', 'data'));
});

test('root aliases allow cleanup without allowing linked runs', async t => {
  const { root, profile } = await fixture(t);
  const alias = path.join(root, 'alias');
  await symlink(root, alias, 'junction');
  const linked = path.join(root, '.pre04-runs', 'smoke-456');
  await symlink(path.dirname(profile), linked, 'junction');
  await assert.rejects(cleanupTestCache(alias, path.join(alias, '.pre04-runs', 'smoke-456', 'profile')), /linked/);
  await access(path.join(profile, 'Cache', 'data'));
  await cleanupTestCache(alias, path.join(alias, '.pre04-runs', 'smoke-123', 'profile'));
  await assert.rejects(access(path.join(profile, 'Cache')), { code: 'ENOENT' });
  await access(path.join(profile, 'recovery', 'data'));
});

test('cleanup runs after close and does not run when close fails', async t => {
  const { root, profile } = await fixture(t);
  let fail = true;
  const launcher = withTestCacheCleanup({ async launch() { return { async close() {
    await access(path.join(profile, 'Cache', 'data'));
    if (fail) throw new Error('still running');
  } }; } }, root);
  const app = await launcher.launch({ env: { METIS_USER_DATA: profile } });
  await assert.rejects(app.close(), /still running/);
  await access(path.join(profile, 'Cache', 'data'));
  fail = false;
  await app.close();
  await assert.rejects(access(path.join(profile, 'Cache')), { code: 'ENOENT' });
});

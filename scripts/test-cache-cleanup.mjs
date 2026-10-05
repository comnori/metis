import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

export const cacheNames = ['Cache', 'Code Cache', 'Dictionaries', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary'];

async function hasLink(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return true;
  if (!info.isDirectory()) return false;
  for (const entry of await readdir(target)) {
    if (await hasLink(path.join(target, entry))) return true;
  }
  return false;
}

// Call only after the test application has closed. Preserve state and evidence.
export async function cleanupTestCache(root, profile) {
  const runs = path.join(await realpath(root), '.pre04-runs');
  // Root aliases (/var on macOS, Windows short paths) are valid; links inside runs are not.
  const relative = path.relative(path.resolve(root, '.pre04-runs'), path.resolve(profile)).split(path.sep);
  if (relative.length !== 2 || relative[1] !== 'profile' || relative[0].startsWith('package-') || !/^[a-z0-9-]+-\d+$/.test(relative[0])) {
    throw new Error('Refusing profile outside a test run');
  }
  const target = path.join(runs, ...relative);
  if (await realpath(target) !== target) throw new Error('Refusing linked test profile');
  for (const name of cacheNames) {
    const cache = path.join(target, name);
    try {
      if (await hasLink(cache)) throw new Error('Linked cache entry');
      await rm(cache, { recursive: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Cache retained: ${cache}: ${error.message}`);
    }
  }
}

export function withTestCacheCleanup(launcher, root) {
  return {
    async launch(options) {
      const app = await launcher.launch(options);
      const close = app.close.bind(app);
      app.close = async (...args) => {
        await close(...args);
        if (options.env?.METIS_USER_DATA) {
          await cleanupTestCache(root, options.env.METIS_USER_DATA)
            .catch(error => console.warn(`Test cache cleanup skipped: ${error.message}`));
        }
      };
      return app;
    },
  };
}

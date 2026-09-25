import { readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

export async function cleanupPackages(root, currentStage) {
  const runs = path.join(await realpath(root), '.pre04-runs');
  if (await realpath(runs) !== runs) throw new Error('Package directory must not be a link');
  const current = path.basename(currentStage);
  if (path.resolve(currentStage) !== path.join(runs, current) || !/^package-\d+$/.test(current)) {
    throw new Error('Invalid current package directory');
  }
  const entries = (await readdir(runs, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^package-\d+$/.test(entry.name))
    .sort((a, b) => Number(b.name.slice(8)) - Number(a.name.slice(8)));
  const keep = new Set([current, ...entries.slice(0, 2).map(entry => entry.name)]);
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    const target = path.join(runs, entry.name);
    if (await realpath(target) !== target) throw new Error(`Refusing linked package: ${target}`);
    try {
      await rm(target, { recursive: true });
      console.log(`Removed old package: ${entry.name}`);
    } catch (error) {
      console.warn(`Could not remove old package ${entry.name}: ${error.message}`);
    }
  }
}

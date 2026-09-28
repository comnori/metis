import { spawn } from 'node:child_process';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import { cleanupPackages } from './package-cleanup.mjs';
const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const run = (command, args, cwd = root, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true, ...options });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Process exited ${code}`)));
});
await run(process.execPath, [path.join(root, 'scripts/build.mjs')]);
if (process.argv[2] === 'package') {
  const stage = path.join(root, '.pre04-runs', `package-${Date.now()}`);
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  await mkdir(stage, { recursive: true });
  await cp(path.join(root, 'apps/desktop/dist'), path.join(stage, 'dist'), { recursive: true });
  await copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'metis', productName: 'Metis', version, description: 'AsciiDoc knowledge workspace', author: 'Yongsik Yun', license: 'MIT', main: 'dist/main/main.cjs', devDependencies: { electron: '44.3.0' }, config: { forge: { packagerConfig: { asar: true }, makers: [] } } }, null, 2));
  await run(process.execPath, [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'package'], stage);
  await writeFile(path.join(root, '.pre04-runs/latest-package.txt'), stage);
  await cleanupPackages(root, stage);
} else await run(electron, [path.join(root, 'apps/desktop'), ...process.argv.slice(3)], root, { windowsHide: false });

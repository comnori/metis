import { build } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { copyFile } from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps/desktop');
await build({ configFile: false, root: path.join(desktop, 'src/renderer'), base: './', build: { outDir: path.join(desktop, 'dist/renderer'), emptyOutDir: true } });
for (const [source, target] of [['dist/browser/index.js', 'd2-engine.js'], ['LICENSE.txt', 'd2-LICENSE.txt'], ['THIRD_PARTY_NOTICES.txt', 'd2-THIRD_PARTY_NOTICES.txt']]) {
  await copyFile(path.join(root, 'node_modules/@d2lang/d2', source), path.join(desktop, 'dist/renderer', target));
}
await copyFile(path.join(root, 'node_modules/gifenc/LICENSE.md'), path.join(desktop, 'dist/renderer/gifenc-LICENSE.txt'));
for (const name of ['main', 'preload', 'utility']) {
  await build({ configFile: false, resolve: { conditions: ['node'], alias: name === 'utility' ? { '@asciidoctor/core': path.join(root, 'node_modules/@asciidoctor/core/build/node/index.cjs') } : {} }, build: { target: 'node24', outDir: path.join(desktop, 'dist', name), emptyOutDir: true,
    lib: { entry: path.join(desktop, `src/${name}/${name}.ts`), formats: ['cjs'], fileName: () => `${name}.cjs` },
    rolldownOptions: { external: ['electron', ...builtinModules, ...builtinModules.map(name => `node:${name}`)] } } });
}

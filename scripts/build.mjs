import { build } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps/desktop');
await build({ configFile: false, root: path.join(desktop, 'src/renderer'), base: './', build: { outDir: path.join(desktop, 'dist/renderer'), emptyOutDir: true } });
for (const name of ['main', 'preload', 'utility']) {
  await build({ configFile: false, resolve: { conditions: ['node'], alias: name === 'utility' ? { '@asciidoctor/core': path.join(root, 'node_modules/@asciidoctor/core/build/node/index.cjs') } : {} }, build: { target: 'node24', outDir: path.join(desktop, 'dist', name), emptyOutDir: true,
    lib: { entry: path.join(desktop, `src/${name}/${name}.ts`), formats: ['cjs'], fileName: () => `${name}.cjs` },
    rolldownOptions: { external: ['electron', ...builtinModules, ...builtinModules.map(name => `node:${name}`)] } } });
}

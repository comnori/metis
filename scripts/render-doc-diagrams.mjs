import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'doc/diagrams');
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.mmd')).sort()) {
    const source = await readFile(path.join(directory, file), 'utf8');
    const id = file.replace('.mmd', '');
    const svg = await page.evaluate(async ({ source, id }) => {
      const { default: mermaid } = await import('/node_modules/mermaid/dist/mermaid.esm.min.mjs');
      mermaid.initialize({ startOnLoad: false, theme: 'default', deterministicIds: true, deterministicIDSeed: id, flowchart: { htmlLabels: false }, fontFamily: 'Arial, "Malgun Gothic", sans-serif' });
      return (await mermaid.render(id, source)).svg;
    }, { source, id });
    const hash = createHash('sha256').update(source).digest('hex');
    await writeFile(path.join(directory, `${id}.svg`), `<!-- Mermaid source SHA-256: ${hash} -->\n${svg}\n`);
    console.log(`${file} -> ${id}.svg`);
  }
} finally {
  await browser?.close();
  await server.close();
}

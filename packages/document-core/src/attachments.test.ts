import { expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from './index';
test('keeps Asciidoctor media targets, attributes and include image semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-media-'));
  try {
    await fs.mkdir(path.join(root, 'parts'));
    await fs.writeFile(path.join(root, 'parts/body.adoc'), 'image::included.png[Included]');
    const result = await analyze(root, 'note.adoc', '= Media\n:imagesdir: assets\n:picture: 한%20글.png\n\n.Caption\nimage::{picture}[Alt,120,80]\n\nInline image:icon.svg[Icon].\n\ninclude::parts/body.adoc[]\n\naudio::audio/song.wav[start=1,opts=loop]\n\nvideo::video/clip.webm[poster=poster.png,start=2]\n\nlink:assets/report.pdf[Report]');
    expect(result.imagesDirectory).toBe('assets');
    expect(result.html).toContain('src="assets/한%20글.png"');
    expect(result.html).toContain('width="120"'); expect(result.html).toContain('height="80"');
    expect(result.html).toContain('assets/included.png');
    expect(result.html).toContain('assets/icon.svg');
    expect(result.html).toContain('audio/song.wav#t=1');
    expect(result.html).toContain('video/clip.webm#t=2');
    expect(result.html).toContain('poster="assets/poster.png"');
    expect(result.html).toContain('href="assets/report.pdf"');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

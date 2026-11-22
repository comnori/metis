import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), packaged = process.argv[2];
const run = path.join(root, '.pre04-runs', `attachments-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(path.join(fixture, 'assets'), { recursive: true });
let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
await writeFile(path.join(fixture, 'assets', 'pixel.png'), png);
await writeFile(path.join(run, 'import.png'), png);
await writeFile(path.join(fixture, 'assets', 'report.pdf'), '%PDF-1.4\n%%EOF');
await writeFile(path.join(fixture, 'assets', 'script.cmd'), '@echo test');
await writeFile(path.join(fixture, 'assets', 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>parent.svgExecuted=true</script><image href="https://example.invalid/leak"/><rect width="10" height="10" fill="red"/></svg>');
const wav = Buffer.alloc(44 + 16000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
await writeFile(path.join(fixture, 'assets', 'tone.wav'), wav);
await writeFile(path.join(fixture, 'assets', 'broken.mp4'), 'unsupported media');
const source = '= Attachments\n:imagesdir: assets\n\n.Caption\nimage::pixel.png[Pixel,32,32]\n\nInline image:pixel.png[Inline,16,16].\n\nimage::unsafe.svg[SVG]\n\naudio::tone.wav[]\n\nvideo::movie.webm[poster=pixel.png]\n\nlink:assets/report.pdf[Report]\n\nvideo::broken.mp4[]\n\nlink:assets/script.cmd[Script]\n\nimage::missing.png[Missing]\n\nimage::https://example.invalid/remote.png[Remote]\n';
await writeFile(path.join(fixture, 'note.adoc'), source);
await writeFile(path.join(fixture, 'other.adoc'), '= Other');
const report = { status: 'running', platform: process.platform, packaged: !!packaged, checks: [] };
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const errors = [];
try {
  app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await app.evaluate(({ dialog, shell, BrowserWindow }, folder) => {
    BrowserWindow.getAllWindows()[0].showInactive();
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBoxSync = () => 1;
    globalThis.attachmentOpened = []; globalThis.attachmentRevealed = [];
    shell.openPath = async file => { globalThis.attachmentOpened.push(file); return globalThis.attachmentOpenFailure ? 'Test open failure' : ''; };
    shell.showItemInFolder = file => globalThis.attachmentRevealed.push(file);
  }, fixture);
  png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 4; c.height = 4; c.getContext('2d').fillRect(0, 0, 4, 4); return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))); }));
  await writeFile(path.join(fixture, 'assets', 'pixel.png'), png); await writeFile(path.join(run, 'import.png'), png);
  // Create a real supported video fixture with the same Chromium codec used by the app.
  const video = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => recorder.onstop = resolve); recorder.start();
    for (let i = 0; i < 10; i++) { canvas.getContext('2d').fillStyle = i % 2 ? 'red' : 'blue'; canvas.getContext('2d').fillRect(0, 0, 64, 64); await new Promise(resolve => setTimeout(resolve, 100)); }
    recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await writeFile(path.join(fixture, 'assets', 'movie.webm'), Buffer.from(video));
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '분할', exact: true }).click();
  const frame = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await frame.locator('img[src^="metis-attachment:"]').first().waitFor();
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe[title="AsciiDoc 미리보기"]').contentDocument;
    return [...doc.querySelectorAll('img[src]')].length >= 3 && [...doc.querySelectorAll('img[src]')].every(img => img.complete && img.naturalWidth > 0);
  });
  assert.equal(await frame.locator('img[alt="Pixel"]').getAttribute('width'), '32');
  assert.equal(await page.evaluate(() => !!window.svgExecuted), false);
  assert.ok(await frame.getByText('로컬 상대 첨부 경로만 지원합니다.', { exact: false }).count());
  report.checks.push('block/inline images, SVG isolation, dimensions and remote/missing diagnostics');
  for (const tag of ['audio', 'video']) {
    console.log('Checking media', tag);
    await page.waitForFunction(tag => document.querySelector('iframe').contentDocument.querySelector(tag)?.readyState >= 1, tag);
    const result = await page.evaluate(async tag => { const media = document.querySelector('iframe').contentDocument.querySelector(tag); media.muted = true; await Promise.race([media.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('play timeout: ' + media.outerHTML + ' ready=' + media.readyState + ' network=' + media.networkState + ' error=' + media.error?.message)), 5000))]); await new Promise(resolve => setTimeout(resolve, 150)); media.pause(); media.currentTime = 0.25; return { duration: media.duration, time: media.currentTime, error: media.error?.message }; }, tag);
    assert.ok(result.duration > 0); assert.equal(result.time, 0.25); assert.equal(result.error, undefined);
  }
  await frame.getByText('첨부를 표시하거나 재생할 수 없습니다.', { exact: false }).waitFor();
  report.checks.push('WAV and VP8 WebM actual playback, seek and invalid codec fallback');
  console.log('Checking file links');
  await frame.getByText('Report', { exact: true }).click();
  await frame.getByText('Script', { exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.attachmentOpened.length), 1);
  assert.equal(await app.evaluate(() => globalThis.attachmentRevealed.length), 1);
  await app.evaluate(() => { globalThis.attachmentOpenFailure = true; });
  await frame.getByText('Report', { exact: true }).click();
  await page.getByRole('button', { name: '파일 위치 열기', exact: true }).click();
  report.checks.push('passive attachment open, script reveal and failed open fallback');
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.click(); await page.keyboard.press('ControlOrMeta+End');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(run, 'import.png'));
  await page.getByRole('button', { name: '첨부파일 삽입', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent?.includes('image::import.png[import.png]'));
  assert.deepEqual(await readFile(path.join(fixture, 'assets', 'import.png')), png);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  assert.equal(await editor.textContent().then(t => t.includes('image::import.png')), false);
  assert.deepEqual(await readFile(path.join(fixture, 'assets', 'import.png')), png);
  report.checks.push('file picker, imagesdir insertion and undo retains copied file');
  await editor.evaluate((element, png) => {
    const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(png)], 'clip.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [...png]);
  await page.waitForFunction(() => /image::image-\d+\.png/.test(document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent));
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'attachment-test-input'; input.hidden = true; document.body.append(input); });
  await page.locator('#attachment-test-input').setInputFiles([path.join(fixture, 'assets', 'pixel.png'), path.join(run, 'import.png')]);
  await editor.click(); await page.keyboard.press('ControlOrMeta+End');
  await page.evaluate(() => {
    const rect = document.querySelector('.editor-panel:not([hidden]) .cm-line:last-child').getBoundingClientRect();
    const data = new DataTransfer(); for (const file of document.querySelector('#attachment-test-input').files) data.items.add(file);
    document.querySelector('.editor-panel:not([hidden]) .cm-content').dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: rect.left + 4, clientY: rect.top + 4, bubbles: true, cancelable: true }));
    document.querySelector('#attachment-test-input').remove();
  });
  await page.waitForFunction(() => document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent?.includes('image::import-1.png[import-1.png]'));
  assert.deepEqual(await readFile(path.join(fixture, 'assets', 'import-1.png')), png);
  report.checks.push('multi-file drop, existing local reference and duplicate filename');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor();
  assert.match(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), /image::image-\d+\.png/);
  report.checks.push('clipboard PNG and save');
  await page.getByRole('button', { name: 'note.adoc 탭 닫기', exact: true }).click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.editor-panel:not([hidden]) .cm-content')?.textContent?.includes('image::import-1.png'));
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => { await new Promise(resolve => setTimeout(resolve, 700)); return { canceled: false, filePaths: [file] }; }; }, path.join(run, 'import.png'));
  await editor.click(); await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: '첨부파일 삽입', exact: true }).click();
  await page.getByRole('button', { name: '≡other.adoc', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-content')].some(element => element.textContent.includes('image::import-2.png')));
  assert.equal((await editor.textContent()).includes('image::'), false);
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  report.checks.push('reopen saved macros and async insertion stays in original tab');
  await page.screenshot({ path: path.join(run, 'window.png') });
  report.status = 'passed'; report.consoleErrors = errors;
} catch (error) { report.consoleErrors = errors; report.ui = await page?.locator('body').innerText().catch(() => ''); report.media = await page?.evaluate(() => [...(document.querySelector('iframe')?.contentDocument?.querySelectorAll('audio,video') ?? [])].map(m => ({ tag: m.tagName, html: m.outerHTML, state: m.readyState, network: m.networkState, error: m.error?.message }))).catch(() => []); report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
finally { await writeFile(path.join(run, 'results.json'), JSON.stringify(report, null, 2)); await app?.close(); }
console.log(JSON.stringify(report, null, 2)); console.log(`Attachment report: ${run}`);

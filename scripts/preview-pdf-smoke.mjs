import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `preview-pdf-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(path.join(fixture, 'assets'), { recursive: true });
await writeFile(path.join(fixture, 'assets/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64'));
const source = `= 미리보기 PDF 검증

한글 본문과 다이어그램을 함께 저장합니다.

== Mermaid 흐름

[mermaid]
----
flowchart LR
  A[입력 시작] --> B[내용 확인]
  B --> C[PDF 저장 완료]
----

== D2 구성

[d2]
----
direction: right
client: Client
server: Server
client -> server: Request
layers: {
  detail: {
    notes: |md
      # D2 Markdown
      **Included detail**
    |
    db: Database {shape: cylinder}
    notes -> db: Stored
  }
}
----

== 첨부 이미지

image::assets/pixel.png[첨부 확인,80,40]

== 긴 본문

${Array.from({ length: 35 }, (_, i) => `문단 ${i + 1}. 페이지 나눔 뒤에도 본문과 다이어그램이 정상적으로 표시되는지 확인합니다.\n`).join('\n')}
`;
await writeFile(path.join(fixture, 'note.adoc'), source);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(40000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  const badge = await app.evaluate(({ nativeImage }) => {
    const pixels = Buffer.alloc(80 * 40 * 4);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 70; pixels[i + 1] = 170; pixels[i + 2] = 245; pixels[i + 3] = 255; }
    return nativeImage.createFromBitmap(pixels, { width: 80, height: 40 }).toPNG().toString('base64');
  });
  await writeFile(path.join(fixture, 'assets/pixel.png'), Buffer.from(badge, 'base64'));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await uiCommand(page, '설정');
  const settings = page.getByRole('dialog', { name: '설정' });
  await settings.getByRole('button', { name: '미리보기', exact: true }).click();
  const delay = settings.getByRole('slider', { name: '미리보기 갱신 대기 시간' });
  await delay.fill('1700');
  await settings.getByRole('button', { name: '직전 변경 되돌리기', exact: true }).click();
  assert.equal(await delay.inputValue(), '800');
  await delay.fill('1700');
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload(); await uiCommand(page, '설정');
  await settings.getByRole('button', { name: '미리보기', exact: true }).click();
  assert.equal(await delay.inputValue(), '1700');
  await settings.getByRole('button', { name: '이 범주 기본값 복원', exact: true }).click();
  assert.equal(await delay.inputValue(), '800');
  await delay.fill('200');
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '분할', exact: true }).click();
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-mermaid-output svg').waitFor();
  await preview.locator('.metis-d2-output svg').first().waitFor();
  assert.equal(await preview.locator('details[data-d2-board]').getAttribute('open'), null);
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  await editor.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nPDF unsaved snapshot\n');
  await preview.getByText('PDF unsaved snapshot', { exact: true }).waitFor();
  const output = path.join(run, 'preview.pdf');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async (_parent, options) => {
    if (options.defaultPath !== 'note.pdf') throw Error('Incorrect default PDF filename');
    return { canceled: false, filePath: output };
  }; }, output);
  await page.getByRole('button', { name: 'PDF 다운로드', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^PDF를 저장했습니다\.$/ }).waitFor();
  const pdf = await readFile(output); assert.equal(pdf.subarray(0, 4).toString(), '%PDF'); assert.ok(pdf.length > 20000);
  assert.equal(await preview.locator('details[data-d2-board]').getAttribute('open'), null);
  assert.equal(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), source);
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  const saved = (await stat(output)).mtimeMs;
  await page.getByRole('button', { name: 'PDF 다운로드', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^PDF 저장을 취소했습니다\.$/ }).waitFor();
  assert.equal((await stat(output)).mtimeMs, saved); assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(run, 'preview.png') });
  console.log(JSON.stringify({ run, output, checks: ['workspace delay persistence, undo and reset', 'live Mermaid and D2 rendered before PDF', 'unsaved buffer export', 'collapsed D2 detail included without changing preview', 'local attachment image', 'save cancellation'] }, null, 2));
} catch (error) {
  if (page) { console.error((await page.locator('body').innerText()).slice(-4000)); await page.screenshot({ path: path.join(run, 'failed.png') }); }
  throw error;
} finally { await app.close(); }

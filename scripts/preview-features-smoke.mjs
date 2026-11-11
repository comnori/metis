import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `preview-features-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, 'preview.adoc'), `= Preview features

[source,javascript]
----
const greeting = "hello";
----

.Flow
[mermaid]
----
flowchart LR
  A[AsciiDoc] --> B[Preview]
----

[mermaid]
----
flowchart LR
  A - broken
----

.Video example
video::rPQoq7ThGAU[youtube,start=5,end=20,opts=autoplay]
`);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  let videoRequests = 0;
  await page.route('https://www.youtube-nocookie.com/embed/*', async route => {
    videoRequests++;
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><p id="player">Loading</p><script>document.getElementById("player").textContent="Player scripts enabled"</script>' });
  });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('button', { name: '≡preview.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('.metis-mermaid-output svg').waitFor();
  assert.equal(await preview.locator('.hljs-keyword').count(), 1);
  assert.equal(await preview.locator('.metis-mermaid-output svg').count(), 1);
  assert.equal(await preview.locator('.metis-mermaid-error pre').count(), 1);
  const policy = await preview.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(policy?.includes("script-src 'none'"));
  assert.equal(await preview.locator('style[data-theme="asciidoctor"]').count(), 1);
  assert.equal(await preview.locator('style[data-theme="highlight"]').count(), 1);
  assert.equal(await preview.locator('style[data-theme="metis"]').count(), 1);
  assert.equal(videoRequests, 0);
  await preview.locator('.metis-embed-unavailable').waitFor();
  const manager = page.getByRole('dialog', { name: '설정' });
  const extension = name => manager.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await uiCommand(page, '확장 관리');
  await extension('Mermaid 다이어그램').getByRole('button', { name: '비활성화', exact: true }).click();
  await extension('YouTube 영상').getByRole('button', { name: '활성화', exact: true }).click();
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  const video = preview.locator('.metis-youtube iframe'); await video.waitFor(); await video.scrollIntoViewIfNeeded();
  await preview.frameLocator('.metis-youtube iframe').getByText('Player scripts enabled').waitFor();
  assert.equal(await preview.locator('.metis-mermaid-output svg').count(), 0);
  assert.equal(await preview.locator('.metis-mermaid pre').count(), 2);
  assert.equal(await video.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/rPQoq7ThGAU?rel=0&start=5&end=20');
  const frame = page.frames().find(f => f.name() === '' && f.url() === 'about:srcdoc');
  assert.ok(frame);
  await frame.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.documentScriptRan=true'; document.body.append(script); });
  assert.equal(await frame.evaluate(() => window.documentScriptRan), undefined);
  await page.reload();
  await uiCommand(page, '확장 관리');
  await extension('Mermaid 다이어그램').getByRole('button', { name: '활성화', exact: true }).waitFor();
  await extension('YouTube 영상').getByRole('button', { name: '비활성화', exact: true }).waitFor();
  await extension('Mermaid 다이어그램').getByRole('button', { name: '활성화', exact: true }).click();
  await extension('YouTube 영상').getByRole('button', { name: '제거', exact: true }).click();
  await manager.getByRole('group', { name: '확장 제거 확인', exact: true }).getByRole('button', { name: '확장 제거', exact: true }).click();
  await extension('YouTube 영상').getByRole('button', { name: '다시 추가', exact: true }).click();
  await extension('YouTube 영상').getByRole('button', { name: '활성화', exact: true }).waitFor();
  await manager.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '≡preview.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await preview.locator('.metis-mermaid-output svg').waitFor();
  await preview.locator('.metis-embed-unavailable').waitFor();
  assert.equal(await preview.locator('iframe').count(), 0);
  await page.screenshot({ path: path.join(run, 'preview-extensions.png') });
  console.log(JSON.stringify({ run, checks: ['offline syntax highlighting', 'sanitized Mermaid SVG and error fallback', 'Asciidoctor theme order', 'document scripts blocked while nested player scripts run', 'live extension toggles and persisted preferences', 'YouTube disabled makes no player requests', 'YouTube removal and reinstall clear embeds'] }, null, 2));
} finally { await app.close(); }

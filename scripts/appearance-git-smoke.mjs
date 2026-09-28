import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `appearance-git-${Date.now()}`), parent = path.join(run, 'parent'), css = path.join(run, 'custom.css');
await mkdir(parent, { recursive: true }); await writeFile(css, 'h1 { letter-spacing: 7px }');
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow, dialog }, { parent, css }) => {
    BrowserWindow.getAllWindows()[0].showInactive();
    const paths = [parent, css];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.shift()] });
    dialog.showMessageBox = async (...args) => { const options = args.at(-1); globalThis.__metisGitPrompt = { buttons: [...options.buttons], defaultId: options.defaultId, cancelId: options.cancelId }; return { response: 0, checkboxChecked: false }; };
  }, { parent, css });
  await page.getByRole('button', { name: '새 작업 공간', exact: true }).click();
  await page.getByLabel('폴더 이름').fill('styled'); await page.getByRole('button', { name: '상위 폴더 선택', exact: true }).click();
  await page.getByRole('heading', { name: '작업 공간을 열었습니다.' }).waitFor();
  const workspace = path.join(parent, 'styled'); await access(path.join(workspace, '.git'));
  const prompt = await app.evaluate(() => globalThis.__metisGitPrompt);
  assert.deepEqual(prompt.buttons, ['Git 초기화', '건너뛰기']); assert.equal(prompt.defaultId, 1); assert.equal(prompt.cancelId, 1);
  await writeFile(path.join(workspace, 'note.adoc'), '= Styled\n\nBody'); await page.getByRole('button', { name: '새로 고침', exact: true }).click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click(); const settings = page.getByRole('dialog', { name: '보기 설정' });
  await settings.getByLabel(/UI 크기/).fill('18');
  await settings.getByLabel('AsciiDoc font-family').fill('"Courier New", monospace'); await settings.getByLabel('AsciiDoc font-family').blur();
  await settings.getByLabel(/AsciiDoc 크기/).fill('19'); await settings.getByRole('combobox', { name: '내장 테마', exact: true }).selectOption('dark');
  await settings.getByRole('button', { name: 'CSS 파일 선택', exact: true }).click();
  await settings.getByText('연결된 CSS: custom.css', { exact: false }).waitFor(); await settings.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.locator('.app').evaluate(element => getComputedStyle(element).getPropertyValue('--ui-font-scale').trim()), '1.125');
  await page.getByRole('button', { name: '미리보기', exact: true }).click(); const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.locator('h1').waitFor();
  assert.equal(await preview.locator('body').evaluate(element => getComputedStyle(element).fontSize), '19px');
  assert.match(await preview.locator('body').evaluate(element => getComputedStyle(element).fontFamily), /Courier New/);
  assert.equal(await preview.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(30, 36, 34)');
  assert.equal(await preview.locator('h1').evaluate(element => getComputedStyle(element).letterSpacing), '7px');
  console.log(JSON.stringify({ checks: ['git init confirmation', 'workspace appearance', 'dark preview theme', 'custom CSS'] }, null, 2));
} finally { await app.close(); }

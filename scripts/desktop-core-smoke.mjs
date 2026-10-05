import { electron } from './test-electron.mjs';
import { uiCommand } from './ui-command.mjs';
import executablePath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const [run, packaged] = process.argv.slice(2);
const fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true });
const original = '\uFEFF= Original\r\n\r\nOriginal body  ';
const target = path.join(fixture, 'note.adoc');
await writeFile(target, original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const report = { status: 'running', stage: 'launch', platform: process.platform, packaged: !!packaged, commit: process.env.GITHUB_SHA ?? null, checks: [] };
let app, page;
try {
  app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env, timeout: 30000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  await page.getByRole('heading', { name: '문서가 있는 곳에서 시작하세요.' }).waitFor();
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process, typeof window.metis.invoke, typeof window.metis.openWorkspace]), ['undefined', 'undefined', 'undefined', 'function']);
  report.checks.push('startup and renderer isolation');
  report.stage = 'open workspace';
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    dialog.showMessageBoxSync = () => 1;
  }, fixture);
  await uiCommand(page, '폴더 열기');
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content');
  const ready = async text => {
    await editor.waitFor();
    await page.waitForFunction(({ text }) => {
      const element = document.querySelector('.editor-panel:not([hidden]) .cm-content');
      return element?.getAttribute('contenteditable') === 'true' && element.textContent.includes(text);
    }, { text });
  };
  await ready('Original');
  assert.equal(await readFile(target, 'utf8'), original);
  report.checks.push('workspace and source open without rewriting bytes');
  report.stage = 'edit and preview';
  await editor.click(); await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('= Core document\n\n== Core section\n\nmetis-core-search-token  ');
  await ready('metis-core-search-token');
  await page.getByRole('button', { name: '분할', exact: true }).click();
  await page.frameLocator('iframe[title="AsciiDoc 미리보기"]').getByRole('heading', { name: 'Core section', exact: true }).waitFor();
  assert.equal(await readFile(target, 'utf8'), original);
  report.checks.push('unsaved edit preview preserves disk source');
  report.stage = 'save and reopen';
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor();
  assert.equal(await readFile(target, 'utf8'), '\uFEFF= Core document\r\n\r\n== Core section\r\n\r\nmetis-core-search-token  ');
  await page.getByRole('button', { name: 'note.adoc 탭 닫기', exact: true }).click();
  await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  await ready('metis-core-search-token');
  report.checks.push('save preserves BOM CRLF trailing spaces and reopen content');
  report.stage = 'create document';
  await uiCommand(page, '새 문서');
  const create = page.getByRole('dialog', { name: '새 문서', exact: true });
  await create.getByLabel('문서 이름 (.adoc)').fill('created.adoc');
  await create.getByRole('button', { name: '만들기', exact: true }).click();
  await page.getByRole('heading', { name: 'created.adoc', exact: true }).waitFor();
  await readFile(path.join(fixture, 'created.adoc'), 'utf8');
  report.checks.push('new document created on disk');
  report.stage = 'search';
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByRole('searchbox', { name: '검색어' }).fill('metis-core-search-token');
  await page.locator('.search-result').filter({ hasText: 'note.adoc' }).first().click();
  await page.getByRole('heading', { name: 'note.adoc', exact: true }).waitFor();
  await ready('metis-core-search-token');
  report.checks.push('search opens saved document');
  report.status = 'passed'; report.stage = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? error.message;
  console.error(report.error); process.exitCode = 1;
} finally {
  if (page) await page.screenshot({ path: path.join(run, report.status === 'passed' ? 'window.png' : 'failure.png') }).catch(() => {});
  if (app) await app.close().catch(error => { report.status = 'failed'; report.closeError = error.message; process.exitCode = 1; });
  await writeFile(path.join(run, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

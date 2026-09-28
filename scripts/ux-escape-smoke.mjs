import { uiCommand } from './ui-command.mjs';
import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `ux-escape-${Date.now()}`), fixture = path.join(run, 'workspace');
await mkdir(fixture, { recursive: true }); const original = '= Observe\n\nneedle'; await writeFile(path.join(fixture, 'note.adoc'), original);
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2], observations = [];
const app = await electron.launch({ executablePath: packaged || executablePath, args: packaged ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('dialog', d => { void d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => { BrowserWindow.getAllWindows()[0].showInactive(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBoxSync = () => 1; }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click(); await page.getByRole('button', { name: '≡note.adoc', exact: true }).click();
  const editor = page.locator('.editor-panel:not([hidden]) .cm-content'); await editor.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUnsaved');
  for (const scenario of ['search-filled', 'search-empty', 'search-result', 'quick-open-filled', 'settings-filled']) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const settings = scenario === 'settings-filled', quick = scenario === 'quick-open-filled';
      await uiCommand(page, settings ? '보기 설정' : quick ? '빠른 열기' : '검색');
      const dialog = page.getByRole('dialog', { name: settings ? '보기 설정' : quick ? '빠른 열기' : '작업 공간 검색', exact: true });
      const query = dialog.getByRole('searchbox'); await query.fill(settings ? '파일' : quick ? 'note' : scenario === 'search-empty' ? '' : 'needle');
      await query.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
      assert.equal(await query.inputValue(), settings ? '파일' : quick ? 'note' : scenario === 'search-empty' ? '' : 'needle');
      await query.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
        await query.evaluate((e, init) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })), init);
        assert.equal(await dialog.isVisible(), true);
      }
      if (scenario === 'search-result') { await dialog.locator('.search-result').first().waitFor(); await dialog.locator('.search-result').first().focus(); } else await query.focus();
      await page.keyboard.press('Escape');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const open = await dialog.isVisible(); assert.equal(open, false, scenario);
      observations.push({ scenario, attempt, dialogOpenAfterEscape: open, queryAfterEscape: open ? await query.inputValue() : null });
      if (open) await dialog.getByRole('button', { name: settings ? '닫기' : '검색 닫기', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-focus-home'));
      await uiCommand(page, settings ? '보기 설정' : quick ? '빠른 열기' : '검색');
      await query.waitFor();
      assert.equal(await query.inputValue(), settings ? '' : quick ? 'note' : scenario === 'search-empty' ? '' : 'needle');
      await query.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
      assert.equal(await query.inputValue(), '');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    }
  }
  assert.ok((await editor.textContent()).includes('Unsaved')); assert.equal(await readFile(path.join(fixture, 'note.adoc'), 'utf8'), original);
  const result = { packaged: !!packaged, executable: packaged ?? 'development', observations, sourceUnchanged: true, dirtyBufferPreserved: true, note: 'Escape closes; composition guards, query memory, explicit clear, focus and source protection asserted. Synthetic IME only.' };
  await writeFile(path.join(run, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ run, ...result }, null, 2));
} finally { await app.close(); }

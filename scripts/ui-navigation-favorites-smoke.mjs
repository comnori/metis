import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.pre04-runs', `ui-navigation-favorites-${Date.now()}`);
const fixture = path.join(run, 'workspace');
await mkdir(path.join(fixture, 'shared'), { recursive: true });
await writeFile(path.join(fixture, 'guide.adoc'), '= Guide\n\ninclude::shared/part.adoc[]\n');
await writeFile(path.join(fixture, 'shared', 'part.adoc'), '== Shared part\n');

const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, dialog }, folder) => {
    BrowserWindow.getAllWindows()[0].showInactive();
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, fixture);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await page.getByRole('navigation', { name: '워크스페이스 리본' }).waitFor();
  assert.equal(await page.locator('.app-header').count(), 0);
  assert.equal(await page.getByRole('tab', { name: '파일', exact: true }).getAttribute('aria-selected'), 'true');

  await page.getByRole('button', { name: '▸shared', exact: true }).click();
  await page.getByRole('button', { name: '▾shared', exact: true }).waitFor();
  await page.getByRole('button', { name: '≡part.adoc', exact: true }).waitFor();
  for (const label of ['상위 폴더', '새로 고침', '새 폴더', '새 문서']) assert.equal(await page.getByRole('button', { name: label, exact: true }).locator('svg').count(), 1);
  await page.getByRole('button', { name: '새 문서', exact: true }).hover();
  assert.equal(await page.getByText('새 문서', { exact: true }).filter({ visible: true }).count(), 1);
  await page.screenshot({ path: path.join(run, 'sidebar-actions-tooltip.png') });
  await page.getByRole('button', { name: '≡guide.adoc', exact: true }).click();

  await page.getByRole('button', { name: 'guide.adoc 즐겨찾기 추가', exact: true }).first().click();
  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '즐겨찾기', exact: true }).click();
  await page.locator('.favorites-panel').getByRole('button', { name: 'guide.adoc', exact: true }).waitFor();
  assert.equal(await page.locator('button[aria-label="guide.adoc 즐겨찾기 제거"][aria-pressed="true"]').first().getAttribute('aria-pressed'), 'true');
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith('metis.favorites.v1.'))?.[1]);
  assert.deepEqual(JSON.parse(stored ?? '[]'), ['guide.adoc']);
  await page.screenshot({ path: path.join(run, 'navigation-favorites.png') });

  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '오른쪽 사이드바', exact: true }).click();
  const rightSeparator = page.getByRole('separator', { name: '오른쪽 사이드바 너비 조절' });
  const before = Number(await rightSeparator.getAttribute('aria-valuenow'));
  await rightSeparator.focus(); await rightSeparator.press('ArrowLeft');
  assert.equal(Number(await rightSeparator.getAttribute('aria-valuenow')), before + 10);

  await page.keyboard.press('Control+Shift+F');
  const search = page.locator('.search-panel');
  await search.getByRole('searchbox').fill('Guide');
  await search.locator('.search-result').first().click();
  assert.equal(await search.isVisible(), true);

  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '그래프', exact: true }).click();
  const graph = page.getByRole('region', { name: '그래프 뷰' });
  await graph.getByRole('button', { name: '그래프 문서: shared/part.adoc', exact: true }).waitFor();
  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '그래프', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: '◎ 그래프', exact: true }).count(), 1);
  await page.screenshot({ path: path.join(run, 'navigation-favorites-graph.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await page.getByRole('navigation', { name: '워크스페이스 리본' }).getByRole('button', { name: '파일', exact: true }).click();
  await page.locator('.sidebar-scrim').waitFor();
  await page.screenshot({ path: path.join(run, 'responsive-overlay.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sidebar-scrim').count(), 0);
  console.log(JSON.stringify({ run, checks: ['44px ribbon shell', 'icon-only file actions with tooltips', 'tabbed left and right sidebars', 'persistent embedded search', 'keyboard resizers', 'singleton central graph tab', 'responsive overlay sidebar'] }, null, 2));
} finally {
  await app.close();
}

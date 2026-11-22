import { electron } from './test-electron.mjs';
import executablePath from 'electron';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uiCommand } from './ui-command.mjs';

const root = path.resolve(import.meta.dirname, '..');
const zip = path.resolve(process.argv[2] ?? 'F:/workspace/notionToMetis/dist/notion-to-metis-0.1.1.zip');
const run = path.join(root, '.pre04-runs', `notion-plugin-${Date.now()}`), workspace = path.join(run, 'workspace');
await mkdir(workspace, { recursive: true });
const env = { ...process.env, METIS_USER_DATA: path.join(run, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.join(root, 'apps/desktop'), '--smoke', 'metis://auth/notion-to-metis/callback?state=stale&code=stale'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ app, BrowserWindow, dialog, shell }) => {
    BrowserWindow.getAllWindows()[0].showInactive();
    const http = process.getBuiltinModule('http'), https = process.getBuiltinModule('https'), dns = process.getBuiltinModule('dns/promises');
    const A = 'a'.repeat(32), B = 'b'.repeat(32), D = 'd'.repeat(32), S = 'e'.repeat(32);
    const title = text => ({ type: 'title', title: [{ plain_text: text }] });
    const page = (id, name, parent) => ({ object: 'page', id, url: `https://www.notion.so/${id}`, last_edited_time: '2026-10-25T00:00:00Z', parent, properties: { Name: title(name) } });
    const a = page(A, '가져오기 예제', { type: 'workspace', workspace: true });
    const b = page(B, 'DB 문서', { type: 'data_source_id', data_source_id: S }); b.properties.Status = { type: 'select', select: { name: '진행' } };
    const database = { object: 'database', id: D, title: [{ plain_text: '작업 목록' }], parent: { type: 'workspace' }, data_sources: [{ id: S, name: '작업' }] };
    const source = { object: 'data_source', id: S, title: [{ plain_text: '작업' }], parent: { database_id: D }, properties: { Name: { type: 'title' }, Status: { type: 'select' } } };
    const mock = http.createServer(async (request, response) => {
      let body = ''; for await (const data of request) body += data;
      const url = new URL(request.url, 'http://fixture'), p = url.pathname;
      const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (p === '/v1/oauth/token') return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', workspace_id: 'fixture-workspace', workspace_name: '테스트 Notion' });
      if (p.startsWith('/v1/') && (request.headers.authorization === 'Bearer invalid-fixture-token' || globalThis.__expirePat)) { response.statusCode = 401; return json({ message: 'fixture expired' }); }
      if (p === '/v1/users/me') return json({ object: 'user', id: 'fixture-bot', type: 'bot', bot: { workspace_id: 'fixture-workspace', workspace_name: '테스트 Notion' } });
      if (p === '/v1/search') return json({ results: [a, database], has_more: false });
      if (p === `/v1/databases/${D}`) return json(database);
      if (p === `/v1/data_sources/${S}`) return json(source);
      if (p === `/v1/data_sources/${S}/query`) return json({ results: [b], has_more: false });
      if (p === `/v1/pages/${A}`) return json(a);
      if (p === `/v1/pages/${B}`) return json(b);
      if (p.includes('/children')) return json({ results: [], has_more: false });
      if (p.endsWith('/markdown')) return json({ id: p.includes(A) ? A : B, markdown: p.includes(A) ? `# 한글 제목\n\n**중요한 내용**\n\n- [x] 완료\n\n[DB 문서](https://www.notion.so/${B})\n\n![로컬 사진](https://assets.fixture.test/image.png)` : '# 데이터베이스 본문\n\n오프라인에서도 읽습니다.', truncated: false, unknown_block_ids: [] });
      if (p === '/image.png') { response.setHeader('Content-Type', 'image/png'); return response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')); }
      response.statusCode = 404; json({ message: 'fixture not found: ' + p });
    });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    const port = mock.address().port, originalHttps = https.request, originalLookup = dns.lookup;
    dns.lookup = async (host, options) => ['api.notion.com', 'assets.fixture.test'].includes(host) ? [{ address: '1.1.1.1', family: 4 }] : originalLookup(host, options);
    https.request = (url, options, callback) => ['api.notion.com', 'assets.fixture.test'].includes(new URL(url).hostname)
      ? http.request({ ...options, lookup: undefined, hostname: '127.0.0.1', port, path: new URL(url).pathname + new URL(url).search }, callback)
      : originalHttps(url, options, callback);
    shell.openExternal = async url => {
      globalThis.__openedNotionUrl = url;
      if (!url.startsWith('https://api.notion.com/v1/oauth/authorize')) return;
      const authorize = new URL(url), callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', authorize.searchParams.get('state')); callback.searchParams.set('code', 'fixture-code');
      if (globalThis.__deepLinkEvent === 'open-url') app.emit('open-url', { preventDefault() {} }, callback.href);
      else app.emit('second-instance', {}, [callback.href], process.cwd(), { args: [callback.href], cwd: process.cwd() });
    };
  });
  await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }); }, workspace);
  await page.getByRole('button', { name: '폴더 열기', exact: true }).first().click();
  await uiCommand(page, '확장 관리');
  await app.evaluate(({ dialog }, zip) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [zip] }); }, zip);
  const manager = page.getByRole('dialog', { name: '설정' }); await manager.getByRole('button', { name: 'ZIP 설치', exact: true }).click();
  const plugin = manager.locator('article').filter({ has: page.getByRole('heading', { name: 'Notion 가져오기 · 0.1.1', exact: true }) });
  await plugin.getByRole('button', { name: '활성화', exact: true }).click();
  await plugin.getByRole('button', { name: 'Notion 가져오기', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notion 가져오기', exact: true });
  // Exercise Main's warm-start handlers with a mock provider before PAT setup.
  for (const event of ['second-instance', 'open-url']) {
    await app.evaluate((_electron, event) => { globalThis.__deepLinkEvent = event; }, event);
    const result = await page.evaluate(async () => {
      const session = (await window.metis.startupWorkspace({ requestId: crypto.randomUUID() })).value;
      const call = (action, payload) => window.metis.plugins({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, operation: 'call', pluginId: 'notion-to-metis', payload: { action, payload } });
      const config = await call('auth.configure', { clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: 'metis://auth/notion-to-metis/callback', authorizeUrl: 'https://api.notion.com/v1/oauth/authorize', tokenUrl: 'https://api.notion.com/v1/oauth/token', apiOrigin: 'https://api.notion.com' });
      if (!config.ok) return config;
      const connected = await call('auth.start', {}); await call('auth.disconnect', {}); return connected;
    });
    assert.equal(result.ok, true); assert.equal(result.value.connected, true); assert.ok(!JSON.stringify(result).includes('fixture-access'));
  }
  assert.equal(await panel.getByLabel('Client ID', { exact: true }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: 'Public Connection으로 연결 (준비 중)', exact: true }).isDisabled(), true);
  await panel.getByRole('link', { name: 'Notion PAT 발급 페이지', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.__openedNotionUrl), 'https://www.notion.so/developers/tokens');
  await panel.getByRole('link', { name: 'PAT 발급 방법 · 공식 안내', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.__openedNotionUrl), 'https://developers.notion.com/guides/get-started/personal-access-tokens');
  await page.screenshot({ path: path.join(run, 'pat-settings.png'), fullPage: true });
  await panel.getByLabel('Personal Access Token (PAT)', { exact: true }).fill('invalid-fixture-token');
  await panel.getByRole('button', { name: 'PAT로 연결', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '새 토큰' }).waitFor();
  assert.equal(await panel.getByLabel('Personal Access Token (PAT)', { exact: true }).inputValue(), '');
  await panel.getByLabel('Personal Access Token (PAT)', { exact: true }).fill('fixture-personal-token');
  await panel.getByRole('button', { name: 'PAT로 연결', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'PAT 연결 완료' }).waitFor();
  await app.evaluate(() => { globalThis.__expirePat = true; });
  await panel.getByRole('button', { name: '검색·새로 고침', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '새 PAT' }).waitFor();
  await app.evaluate(() => { globalThis.__expirePat = false; });
  await panel.getByLabel('Personal Access Token (PAT)', { exact: true }).fill('fixture-personal-token');
  await panel.getByRole('button', { name: 'PAT로 연결', exact: true }).click();
  await panel.getByRole('button', { name: '검색·새로 고침', exact: true }).click();
  await panel.getByRole('button', { name: '표시된 항목 전체 선택', exact: true }).click();
  await panel.getByText('4개 선택', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '가져오기 검토', exact: true }).click();
  await panel.getByRole('button', { name: '가져오기 실행', exact: true }).click();
  await panel.getByText('가져오기 결과', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /완료 4개 · 실패 0개/);
  await page.screenshot({ path: path.join(run, 'import-result.png'), fullPage: true });
  const output = path.join(workspace, 'Notion'), backup = path.join(output, '.notion-backup');
  const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(manifest.pages).length, 4);
  const sourcePath = manifest.pages['a'.repeat(32)].path;
  const adoc = await readFile(path.join(workspace, sourcePath), 'utf8'); assert.match(adoc, /xref:/); assert.match(adoc, /image::/);
  const runs = (await readdir(backup, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.match(await readFile(path.join(backup, runs[0], 'a'.repeat(32), 'source.md'), 'utf8'), /^# 한글 제목/);
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  const tree = page.getByRole('navigation', { name: '파일 탐색', exact: true });
  await tree.getByRole('button', { name: '▸Notion', exact: true }).click();
  await tree.getByRole('button', { name: '▸' + sourcePath.split('/')[1], exact: true }).click();
  await tree.getByRole('button', { name: '≡index.adoc', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const preview = page.frameLocator('iframe[title="AsciiDoc 미리보기"]');
  await preview.getByRole('heading', { name: '한글 제목', exact: true }).waitFor();
  assert.equal(await preview.getByRole('img', { name: '로컬 사진', exact: true }).evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await tree.getByRole('button', { name: /\.notion-backup/ }).count(), 0);
  await page.screenshot({ path: path.join(run, 'document-preview.png'), fullPage: true });
  assert.equal(await preview.locator('[data-web-url]').count(), 1);
  await app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__openedNotionUrl = url; }; });
  await preview.getByRole('link', { name: 'Notion 원본', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.__openedNotionUrl), `https://www.notion.so/${'a'.repeat(32)}`);
  await preview.getByRole('link', { name: 'DB 문서', exact: true }).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await preview.getByRole('heading', { name: '데이터베이스 본문', exact: true }).waitFor();
  await uiCommand(page, '확장 관리'); await plugin.getByRole('button', { name: '비활성화', exact: true }).click();
  await plugin.getByRole('button', { name: '제거', exact: true }).click();
  assert.equal(await readFile(path.join(workspace, sourcePath), 'utf8'), adoc);
  assert.deepEqual(errors, []);
  const secretFolder = path.join(run, 'profile', 'plugin-secrets');
  for (const name of await readdir(secretFolder).catch(() => [])) assert.equal((await readFile(path.join(secretFolder, name))).includes(Buffer.from('fixture-personal-token')), false);
  console.log(JSON.stringify({ result: 'passed', workspace, screenshot: path.join(run, 'import-result.png'), documents: 4 }));
} finally { await app.close(); }

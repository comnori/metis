import { afterEach, expect, test, vi } from 'vitest';
import { Readable } from 'node:stream';
import * as network from './plugin-network';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { PluginHost } from './plugin-host';
import { PluginAuth } from './plugin-auth';
import { packageFiles, readPluginFile, writePluginFile, digest, relativeName } from './plugin-files';
import { publicAddress } from './plugin-network';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
const temporary = async () => { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-plugin-test-')); folders.push(folder); return folder; };
const manifest = { id: 'test-extension', name: 'Test', version: '1.0.0', description: 'test', author: 'tests', minAppVersion: '0.2.6', sdkVersion: 1 };
const archive = (overrides = {}) => zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...manifest, ...overrides })), 'main.js': strToU8('export function activate(api) { api.command("test", "Test", () => {}); }') });
const codec = { available: () => false, encrypt: () => new Uint8Array(), decrypt: () => '' };
test('package rejects traversal, unsupported SDK and missing ESM entry', async () => {
  for (const name of ['../outside', 'C:/file', 'a\\b', '.git/config', 'con.txt', 'a/../b']) expect(() => relativeName(name)).toThrow();
  await expect(packageFiles(zipSync({ '../bad': strToU8('bad') }))).rejects.toThrow();
  await expect(packageFiles(archive({ sdkVersion: 99 }))).rejects.toThrow();
  expect((await packageFiles(archive())).manifest.id).toBe(manifest.id);
});
test('exclusive writes and expected hashes preserve concurrent edits', async () => {
  const root = await temporary(), recovery = path.join(root, 'recovery');
  await writePluginFile(root, { path: 'Notion/page.adoc', text: 'original' }, recovery, () => {});
  await expect(writePluginFile(root, { path: 'Notion/page.adoc', text: 'replace' }, recovery, () => {})).rejects.toThrow();
  await expect(writePluginFile(root, { path: 'Notion/page.adoc', text: 'replace', expectedHash: digest('wrong') }, recovery, () => {})).rejects.toThrow();
  expect((await readPluginFile(root, 'Notion/page.adoc'))?.text).toBe('original');
  await writePluginFile(root, { path: 'Notion/page.adoc', text: 'updated', expectedHash: digest('original') }, recovery, () => {});
  expect((await readPluginFile(root, 'Notion/page.adoc'))?.text).toBe('updated');
});
test('ZIP and folder install, activation, duplicate protection, update validation and removal', async () => {
  const root = await temporary(), zip = path.join(root, 'plugin.zip'); await fs.writeFile(zip, archive());
  let selected = zip;
  const scope = { requestId: 'test', workspaceId: 'workspace', workspaceEpoch: 1 };
  const auth = new PluginAuth(path.join(root, 'secrets'), codec, async () => {});
  const host = new PluginHost(() => root, '0.2.6', path.join(root, 'recovery'), auth, async () => selected);
  let result = await host.execute({ ...scope, operation: 'install' }) as any[];
  expect(result[0].enabled).toBe(false);
  await expect(host.execute({ ...scope, operation: 'install' })).rejects.toThrow('이미');
  result = await host.execute({ ...scope, operation: 'enable', pluginId: manifest.id, payload: { enabled: true } }) as any[];
  expect(result[0].enabled).toBe(true); expect((await host.assets(result[0].entryUrl)).status).toBe(200);
  await fs.writeFile(zip, archive({ version: '2.0.0', minAppVersion: '99.0.0' }));
  await expect(host.execute({ ...scope, operation: 'install', pluginId: manifest.id })).rejects.toThrow();
  expect((await host.list(scope))[0].version).toBe('1.0.0');
  selected = path.join(root, 'folder'); await fs.mkdir(selected); await fs.writeFile(path.join(selected, 'manifest.json'), JSON.stringify({ ...manifest, version: '1.1.0' })); await fs.writeFile(path.join(selected, 'main.js'), 'export function activate() {}');
  await host.execute({ ...scope, operation: 'install', pluginId: manifest.id }); expect((await host.list(scope))[0].version).toBe('1.1.0');
  await fs.writeFile(path.join(root, 'keep.adoc'), 'keep');
  await host.execute({ ...scope, operation: 'remove', pluginId: manifest.id }); expect(await host.list(scope)).toEqual([]); expect(await fs.readFile(path.join(root, 'keep.adoc'), 'utf8')).toBe('keep');
});
test('rejects private IPv4 and IPv6 network destinations', () => {
  for (const ip of ['127.0.0.1', '192.168.1.2', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(publicAddress(ip)).toBe(false);
  expect(publicAddress('1.1.1.1')).toBe(true); expect(publicAddress('2606:4700:4700::1111')).toBe(true);
});
test('GitHub install checks release versions and restores the old package after commit failure', async () => {
  const root = await temporary(), scope = { requestId: 'github', workspaceId: 'workspace', workspaceEpoch: 1 };
  let version = '1.0.0', tag = 'v1.0.0';
  vi.spyOn(network, 'remoteText').mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify({ tag_name: tag, assets: [{ name: `test-extension-${version}.zip`, browser_download_url: `https://github.com/test/plugin/releases/download/${tag}/test-extension-${version}.zip` }] }) }));
  vi.spyOn(network, 'remoteResponse').mockImplementation(async () => Object.assign(Readable.from([archive({ version })]), { statusCode: 200 }) as any);
  const host = new PluginHost(() => root, '0.2.6', path.join(root, 'recovery'), new PluginAuth(path.join(root, 'secrets'), codec, async () => {}), async () => undefined);
  await host.execute({ ...scope, operation: 'github', payload: { repository: 'test/plugin' } });
  expect((await host.list(scope))[0]).toMatchObject({ version: '1.0.0', enabled: false, source: 'test/plugin' });
  version = '1.1.0';
  await expect(host.execute({ ...scope, operation: 'github', pluginId: manifest.id })).rejects.toThrow('버전');
  tag = 'v1.1.0';
  const rename = fs.rename.bind(fs);
  const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (String(to).endsWith('plugins.json')) throw Error('fixture config failure'); return rename(from, to); });
  await expect(host.execute({ ...scope, operation: 'github', pluginId: manifest.id })).rejects.toThrow('fixture config failure');
  renameSpy.mockRestore();
  expect((await host.list(scope))[0].version).toBe('1.0.0');
  await host.execute({ ...scope, operation: 'github', pluginId: manifest.id }); expect((await host.list(scope))[0].version).toBe('1.1.0');
});
async function freePort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
test('direct OAuth verifies state, rotates refresh tokens and never returns secrets', async () => {
  const root = await temporary(), port = await freePort(); let browser = '', refreshes = 0, calls = 0;
  const transport = async (url: string, options: any) => {
    if (url.endsWith('/token')) { if (JSON.parse(options.body).grant_type === 'refresh_token') refreshes++; return { status: 200, headers: {}, body: JSON.stringify({ access_token: 'secret-access-' + refreshes, refresh_token: 'secret-refresh', workspace_id: 'w', workspace_name: 'Test' }) }; }
    return { status: calls++ === 0 ? 401 : 200, headers: {}, body: '{}' };
  };
  const auth = new PluginAuth(root, codec, async url => { browser = url; }, transport);
  const config = { clientId: 'client', clientSecret: 'secret', redirectUri: `http://127.0.0.1:${port}/notion/callback`, authorizeUrl: 'https://example.com/authorize', tokenUrl: 'https://example.com/token', apiOrigin: 'https://api.example.com' };
  await auth.configure('w', config);
  const start = auth.start('w', new AbortController().signal);
  while (!browser) await new Promise(resolve => setTimeout(resolve, 5));
  expect((await fetch(config.redirectUri + '?state=wrong&code=test')).status).toBe(400);
  const state = new URL(browser).searchParams.get('state'); await fetch(config.redirectUri + `?state=${state}&code=test`);
  const status = await start; expect(status.connected).toBe(true); expect(JSON.stringify(status)).not.toContain('secret'); expect(await fs.readdir(root)).toEqual([]);
  await auth.http('w', { url: 'https://api.example.com/pages', authenticated: true }, new AbortController().signal); expect(refreshes).toBe(1);
  await expect(auth.http('w', { url: 'https://evil.example/pages', authenticated: true }, new AbortController().signal)).rejects.toThrow();
  expect((await auth.disconnect('w')).connected).toBe(false);
});
test('OAuth timeout and cancellation close the callback listener', async () => {
  const root = await temporary(), port = await freePort(); let opened = false;
  const auth = new PluginAuth(root, codec, async () => { opened = true; });
  await auth.configure('k', { clientId: 'c', clientSecret: 's', redirectUri: `http://127.0.0.1:${port}/callback`, authorizeUrl: 'https://example.com/auth', tokenUrl: 'https://example.com/token', apiOrigin: 'https://example.com' });
  await expect(auth.start('k', new AbortController().signal, 25)).rejects.toThrow('초과');
  const controller = new AbortController(); opened = false; const promise = auth.start('k', controller.signal);
  while (!opened) await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); await expect(promise).rejects.toThrow('취소');
});
test('OAuth reports an occupied callback port without opening the browser', async () => {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port, browser = vi.fn(async () => {});
    const auth = new PluginAuth(await temporary(), codec, browser);
    await auth.configure('occupied', { clientId: 'c', clientSecret: 's', redirectUri: `http://127.0.0.1:${port}/callback`, authorizeUrl: 'https://example.com/auth', tokenUrl: 'https://example.com/token', apiOrigin: 'https://example.com' });
    await expect(auth.start('occupied', new AbortController().signal)).rejects.toThrow('포트'); expect(browser).not.toHaveBeenCalled();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PluginAuth, type SecretCodec } from './plugin-auth';
import { AuthDeepLinks } from './auth-deep-links';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
const temporary = async () => { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-pat-test-')); folders.push(folder); return folder; };
const sessionCodec: SecretCodec = { available: () => false, encrypt() { throw Error('No OS storage'); }, decrypt() { throw Error('No OS storage'); } };
const signal = () => new AbortController().signal;
const identity = { object: 'user', type: 'bot', bot: { workspace_id: 'stable-workspace', workspace_name: '테스트 작업 공간' } };
const ok = (body: unknown = identity) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const pat = (token = 'fixture-personal-token') => ({ provider: 'notion' as const, token });

test('validates PAT at the pinned Notion API, retains workspace identity across replacement, never exposes token', async () => {
  const root = await temporary(), browser = vi.fn(), transport = vi.fn(async () => ok());
  const auth = new PluginAuth(root, sessionCodec, browser, transport);
  const first = await auth.connectPat('workspace/plugin', pat(), signal());
  expect(first).toMatchObject({ mode: 'pat', connected: true, configured: true, persistent: false, workspaceId: 'stable-workspace' });
  expect(JSON.stringify(first)).not.toContain(pat().token);
  expect(transport).toHaveBeenCalledWith('https://api.notion.com/v1/users/me', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-personal-token', 'Notion-Version': '2026-03-11' } }));
  await auth.http('workspace/plugin', { url: 'https://api.notion.com/v1/search', method: 'POST', authenticated: true }, signal());
  await expect(auth.http('workspace/plugin', { url: 'https://other.example/pages', authenticated: true }, signal())).rejects.toThrow('서버');
  expect((await auth.connectPat('workspace/plugin', pat('replacement-token'), signal())).workspaceId).toBe(first.workspaceId);
  expect(browser).not.toHaveBeenCalled(); expect(await fs.readdir(root)).toEqual([]);
  expect((await auth.status('different-workspace/plugin')).connected).toBe(false);
  expect((await auth.disconnect('workspace/plugin')).configured).toBe(false);
});

test('invalid, forbidden and malformed PAT validation preserves the previous connection and redacts responses', async () => {
  let response = ok(); const transport = vi.fn(async () => response);
  const auth = new PluginAuth(await temporary(), sessionCodec, async () => {}, transport);
  await auth.connectPat('w', pat(), signal());
  for (const status of [401, 403, 429, 500]) {
    response = { status, headers: {}, body: 'sensitive-server-error' };
    await expect(auth.connectPat('w', pat('invalid-token'), signal())).rejects.not.toThrow('sensitive-server-error');
    expect((await auth.status('w')).connected).toBe(true);
  }
  response = ok({ object: 'user', type: 'bot', bot: {} });
  await expect(auth.connectPat('w', pat(), signal())).rejects.toThrow('워크스페이스 ID');
  const calls = transport.mock.calls.length;
  await expect(auth.connectPat('w', pat('a\r\nb'), signal())).rejects.toThrow('공백');
  expect(transport.mock.calls.length).toBe(calls);
});

test('expired PAT produces actionable 401 without OAuth refresh or losing a replacement token', async () => {
  let response = ok(); const transport = vi.fn(async () => response);
  const auth = new PluginAuth(await temporary(), sessionCodec, async () => {}, transport);
  await auth.connectPat('w', pat(), signal()); response = { status: 401, headers: {}, body: 'private response' };
  const result = await auth.http('w', { url: 'https://api.notion.com/v1/search', authenticated: true }, signal());
  expect(result.status).toBe(401); expect(result.body).toContain('새 PAT'); expect(transport).toHaveBeenCalledTimes(2);
  expect((await auth.status('w')).connected).toBe(false);
  response = ok(); expect((await auth.connectPat('w', pat('new-token'), signal())).connected).toBe(true);
});

test('cancel or disconnect during validation cannot persist a late result', async () => {
  for (const disconnect of [false, true]) {
    let finish!: (value: ReturnType<typeof ok>) => void;
    const transport = vi.fn(() => new Promise<ReturnType<typeof ok>>(resolve => { finish = resolve; }));
    const auth = new PluginAuth(await temporary(), sessionCodec, async () => {}, transport), controller = new AbortController();
    const attempt = auth.connectPat('w', pat(), controller.signal), rejected = expect(attempt).rejects.toThrow();
    if (disconnect) await auth.disconnect('w'); else controller.abort();
    finish(ok()); await rejected; expect((await auth.status('w')).connected).toBe(false);
  }
});

test('persistent PAT uses only the codec and can be reopened and deleted', async () => {
  const key = randomBytes(32);
  const codec: SecretCodec = {
    available: () => true,
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const content = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), content]); },
    decrypt(bytes) { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); }
  };
  const root = await temporary(), auth = new PluginAuth(root, codec, async () => {}, async () => ok());
  await auth.connectPat('w', pat(), signal());
  const [file] = await fs.readdir(root); expect((await fs.readFile(path.join(root, file))).includes(Buffer.from(pat().token))).toBe(false);
  const restarted = new PluginAuth(root, codec, async () => {}); expect((await restarted.status('w')).connected).toBe(true);
  await restarted.disconnect('w'); expect(await fs.readdir(root)).toEqual([]);
});

test('OAuth can consume a deep link in Main without returning credentials to the renderer', async () => {
  const links = new AuthDeepLinks(); let browser = '';
  const auth = new PluginAuth(await temporary(), sessionCodec, async url => { browser = url; }, async () => ok({ access_token: 'private-access', refresh_token: 'private-refresh', workspace_id: 'w' }), links);
  await auth.configure('w', { clientId: 'client', clientSecret: 'secret', redirectUri: 'metis://auth/notion-to-metis/callback', authorizeUrl: 'https://provider.example/auth', tokenUrl: 'https://provider.example/token', apiOrigin: 'https://api.notion.com' });
  const started = auth.start('w', signal()); await vi.waitFor(() => expect(browser).not.toBe(''));
  const authorize = new URL(browser), callback = `${authorize.searchParams.get('redirect_uri')}?state=${authorize.searchParams.get('state')}&code=one-time`;
  expect(links.receive(callback)).toBe(true); const status = await started;
  expect(status.connected).toBe(true); expect(JSON.stringify(status)).not.toContain('private'); expect(links.receive(callback)).toBe(false);
});

test('external navigation accepts HTTPS links and rejects executable schemes', async () => {
  const browser = vi.fn(async () => {}), auth = new PluginAuth(await temporary(), sessionCodec, browser);
  await auth.openExternal('https://www.notion.so/developers/tokens');
  for (const url of ['file:///secret', 'javascript:alert(1)', 'metis://auth/a/callback', 'https://user:secret@notion.so']) await expect(auth.openExternal(url)).rejects.toThrow();
  expect(browser).toHaveBeenCalledTimes(1);
});

test('disconnect racing with the atomic secret rename cannot resurrect a token', async () => {
  const codec: SecretCodec = { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() };
  const root = await temporary(), auth = new PluginAuth(root, codec, async () => {}, async () => ok());
  const original = fs.rename; let disconnected: Promise<unknown> | undefined;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await original(from, to);
    if (!disconnected) disconnected = auth.disconnect('w');
  });
  await expect(auth.connectPat('w', pat(), signal())).rejects.toThrow('변경'); await disconnected;
  expect(await fs.readdir(root)).toEqual([]);
  expect((await new PluginAuth(root, codec, async () => {}).status('w')).connected).toBe(false);
});

test('cancellation during secret replacement restores the previous connection on disk', async () => {
  const codec: SecretCodec = { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() };
  const root = await temporary(), transport = vi.fn(async () => ok()), auth = new PluginAuth(root, codec, async () => {}, transport);
  await auth.connectPat('w', pat('original-token'), signal());
  const original = fs.rename, controller = new AbortController();
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { await original(from, to); controller.abort(); });
  await expect(auth.connectPat('w', pat('cancelled-token'), controller.signal)).rejects.toThrow();
  const restarted = new PluginAuth(root, codec, async () => {}, transport);
  await restarted.http('w', { url: 'https://api.notion.com/v1/search', authenticated: true }, signal());
  expect(transport).toHaveBeenLastCalledWith('https://api.notion.com/v1/search', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer original-token' }) }));
});

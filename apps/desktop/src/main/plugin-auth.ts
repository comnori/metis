import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PluginOAuthConfig, PluginAuthStatus, PluginHttpResult, PluginPatConfig } from '@metis/contracts';
import { validWebLink } from '@metis/contracts';
import { AuthDeepLinks, callbackProvider } from './auth-deep-links';
import { digest } from './plugin-files';
import { remoteText } from './plugin-network';

interface AuthIdentity { accessToken?: string; workspaceName?: string; workspaceId?: string; invalid?: boolean }
interface OAuthAuth extends AuthIdentity { mode?: 'oauth'; config: PluginOAuthConfig; refreshToken?: string }
interface PatAuth extends AuthIdentity { mode: 'pat'; apiOrigin: string }
type StoredAuth = OAuthAuth | PatAuth;
export interface SecretCodec { available(): boolean; encrypt(text: string): Uint8Array; decrypt(bytes: Buffer): string }
export class PluginAuth {
  private memory = new Map<string, StoredAuth>();
  private refreshes = new Map<string, Promise<void>>();
  private revisions = new Map<string, number>();
  private storage = new Map<string, Promise<void>>();
  constructor(private directory: string, private codec: SecretCodec, private openBrowser: (url: string) => Promise<void>, private transport = remoteText, private deepLinks = new AuthDeepLinks()) {}
  private mutation(key: string, signal?: AbortSignal) {
    const revision = (this.revisions.get(key) ?? 0) + 1; this.revisions.set(key, revision); this.deepLinks.cancelOwner(key);
    return () => { signal?.throwIfAborted(); if (this.revisions.get(key) !== revision) throw Error('인증 설정이 변경되어 이전 요청을 취소했습니다.'); };
  }
  async openExternal(url: unknown) {
    if (!validWebLink(url) || !url.startsWith('https://')) throw Error('유효한 HTTPS 링크가 필요합니다.');
    await this.openBrowser(url);
  }
  private filename(key: string) { return path.join(this.directory, digest(key) + '.secret'); }
  private async storedOperation(key: string, run: () => Promise<void>) {
    const pending = (this.storage.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    this.storage.set(key, pending);
    try { await pending; } finally { if (this.storage.get(key) === pending) this.storage.delete(key); }
  }
  private async read(key: string): Promise<StoredAuth | undefined> {
    await this.storage.get(key)?.catch(() => {});
    if (!this.memory.has(key) && this.codec.available()) {
      const revision = this.revisions.get(key);
      try {
        const value = JSON.parse(this.codec.decrypt(await fs.readFile(this.filename(key))));
        if (revision !== this.revisions.get(key) || this.storage.has(key)) return this.read(key);
        this.memory.set(key, value);
      }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('저장한 인증 정보를 해독하지 못했습니다. 연결 설정을 다시 입력하세요.'); }
    }
    return this.memory.get(key);
  }
  private async save(key: string, value: StoredAuth, check = () => {}) {
    await this.storedOperation(key, async () => {
      check();
      if (this.codec.available()) {
        await fs.mkdir(this.directory, { recursive: true }); const file = this.filename(key), tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
        const previous = await fs.readFile(file).catch(e => { if (e.code !== 'ENOENT') throw e; return undefined; });
        let committed = false;
        try {
          await fs.writeFile(tmp, this.codec.encrypt(JSON.stringify(value)), { mode: 0o600, flush: true, flag: 'wx' }); check();
          await fs.rename(tmp, file); committed = true; check(); this.memory.set(key, value);
        } catch (error) {
          // Restore only ciphertext. Serial storage prevents clobbering a newer connection.
          if (committed) {
            if (previous) { await fs.writeFile(tmp, previous, { mode: 0o600, flush: true, flag: 'wx' }); await fs.rename(tmp, file); }
            else await fs.unlink(file);
          }
          throw error;
        } finally { await fs.unlink(tmp).catch(() => {}); }
        return;
      }
      check(); this.memory.set(key, value);
    });
  }
  async status(key: string): Promise<PluginAuthStatus> {
    const v = await this.read(key);
    return { configured: v?.mode === 'pat' ? !!v.accessToken : !!v?.config.clientSecret, connected: !!v?.accessToken && !v.invalid, persistent: this.codec.available(), mode: v ? v.mode ?? 'oauth' : undefined, clientId: v?.mode !== 'pat' ? v?.config.clientId : undefined, redirectUri: v?.mode !== 'pat' ? v?.config.redirectUri : undefined, workspaceId: v?.workspaceId, workspaceName: v?.workspaceName };
  }
  async connectPat(key: string, input: PluginPatConfig, signal: AbortSignal) {
    if (!input || input.provider !== 'notion' || typeof input.token !== 'string') throw Error('Notion PAT를 입력하세요.');
    const token = input.token.trim();
    if (!/^[\x21-\x7e]{1,4096}$/.test(token)) throw Error('PAT에 공백이나 허용되지 않는 문자가 있습니다. 토큰만 복사하세요.');
    const check = this.mutation(key, signal); check();
    let response: PluginHttpResult;
    try { response = await this.transport('https://api.notion.com/v1/users/me', { signal, headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2026-03-11' } }); }
    catch { check(); throw Error('Notion에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.'); }
    check();
    if (response.status === 401) throw Error('PAT가 올바르지 않거나 만료·취소되었습니다. Notion에서 새 토큰을 발급하세요.');
    if (response.status === 403) throw Error('PAT의 Notion API 권한과 워크스페이스 발급 정책을 확인하세요.');
    if (response.status !== 200) throw Error(`Notion PAT 확인 실패 (${response.status}). 잠시 후 다시 시도하세요.`);
    let user: any; try { user = JSON.parse(response.body); } catch { throw Error('Notion 인증 응답을 확인할 수 없습니다.'); }
    if (user?.object !== 'user' || user.type !== 'bot' || typeof user.bot?.workspace_id !== 'string' || !user.bot.workspace_id) throw Error('Notion 응답에 워크스페이스 ID가 없습니다. PAT의 API 권한을 확인하세요.');
    await this.save(key, { mode: 'pat', apiOrigin: 'https://api.notion.com', accessToken: token, workspaceId: user.bot.workspace_id, workspaceName: typeof user.bot.workspace_name === 'string' ? user.bot.workspace_name.slice(0, 500) : undefined }, check);
    return this.status(key);
  }
  async configure(key: string, input: PluginOAuthConfig) {
    if (!input || typeof input.clientId !== 'string' || !input.clientId || input.clientId.length > 500 || (input.clientSecret !== undefined && (typeof input.clientSecret !== 'string' || input.clientSecret.length > 2000))) throw Error('OAuth 앱 정보를 확인하세요.');
    const redirect = new URL(input.redirectUri), auth = new URL(input.authorizeUrl), token = new URL(input.tokenUrl), api = new URL(input.apiOrigin);
    const deepLink = callbackProvider(input.redirectUri);
    if ((!deepLink && (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || Number(redirect.port) < 1024 || redirect.search || redirect.hash || redirect.username || redirect.password)) || [auth, token, api].some(u => u.protocol !== 'https:' || u.username || u.password)) throw Error('OAuth 주소 또는 콜백 주소를 확인하세요.');
    const check = this.mutation(key);
    const previous = await this.read(key);
    const clientSecret = input.clientSecret || (previous?.mode !== 'pat' && previous?.config.clientId === input.clientId ? previous.config.clientSecret : undefined);
    if (!clientSecret) throw Error('Client Secret을 입력하세요.');
    await this.save(key, { mode: 'oauth', config: { ...input, clientSecret, apiOrigin: api.origin } }, check); return this.status(key);
  }
  async disconnect(key: string) {
    this.mutation(key);
    await this.storedOperation(key, async () => { await fs.unlink(this.filename(key)).catch(e => { if (e.code !== 'ENOENT') throw e; }); this.memory.delete(key); });
    return this.status(key);
  }
  private async exchange(v: OAuthAuth, body: object, signal: AbortSignal) {
    const response = await this.transport(v.config.tokenUrl, { method: 'POST', body: JSON.stringify(body), signal, headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${v.config.clientId}:${v.config.clientSecret}`).toString('base64') } });
    if (response.status !== 200) throw Error(`OAuth 토큰 교환 실패 (${response.status}). 앱 설정을 확인하거나 다시 로그인하세요.`);
    const tokens = JSON.parse(response.body);
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw Error('유효한 OAuth 토큰을 받지 못했습니다.');
    return { ...v, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? v.refreshToken, workspaceName: tokens.workspace_name ?? v.workspaceName, workspaceId: tokens.workspace_id ?? v.workspaceId };
  }
  async start(key: string, signal: AbortSignal, timeout = 180000) {
    const value = await this.read(key); if (value?.mode === 'pat' || !value?.config.clientSecret) throw Error('OAuth 앱 정보를 먼저 저장하세요.');
    const check = this.mutation(key, signal); check();
    const provider = callbackProvider(value.config.redirectUri);
    if (provider) {
      const attempt = this.deepLinks.begin(key, provider, signal, timeout);
      try {
        const authorize = new URL(value.config.authorizeUrl);
        Object.entries({ client_id: value.config.clientId, redirect_uri: attempt.redirectUri, response_type: 'code', owner: 'user', state: attempt.state }).forEach(([k, v]) => authorize.searchParams.set(k, v));
        await this.openBrowser(authorize.href);
        const code = await attempt.code; check();
        const next = await this.exchange(value, { grant_type: 'authorization_code', code, redirect_uri: attempt.redirectUri }, signal);
        await this.save(key, next, check); return this.status(key);
      } finally { attempt.cancel(); }
    }
    const redirect = new URL(value.config.redirectUri), state = randomBytes(32).toString('hex');
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => {
        const u = new URL(request.url ?? '/', redirect.origin);
        if (request.method !== 'GET' || u.pathname !== redirect.pathname) { response.writeHead(404).end(); return; }
        const incoming = Buffer.from(u.searchParams.get('state') ?? ''), expected = Buffer.from(state);
        if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) { response.writeHead(400).end('Invalid OAuth state'); return; }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'");
        if (u.searchParams.has('error')) { response.end('로그인이 취소되었습니다. Metis로 돌아가세요.'); finish(Error('Notion 로그인을 취소했습니다.')); }
        else if (!u.searchParams.get('code')) { response.writeHead(400).end('Missing code'); }
        else { response.end('로그인 응답을 받았습니다. Metis로 돌아가세요.'); finish(undefined, u.searchParams.get('code')!); }
      });
      let done = false;
      const timer = setTimeout(() => finish(Error('로그인 시간이 초과되었습니다.')), timeout);
      const abort = () => finish(Error('로그인을 취소했습니다.'));
      function finish(error?: Error, code?: string) { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); server.close(); server.closeAllConnections(); if (error) reject(error); else resolve(code!); }
      signal.addEventListener('abort', abort, { once: true });
      server.on('error', () => finish(Error('콜백 포트를 열지 못했습니다. 포트를 변경하고 Notion에도 같은 URI를 등록하세요.')));
      if (signal.aborted) { abort(); return; }
      server.listen(Number(redirect.port), '127.0.0.1', () => {
        const authorize = new URL(value.config.authorizeUrl);
        Object.entries({ client_id: value.config.clientId, redirect_uri: redirect.href, response_type: 'code', owner: 'user', state }).forEach(([k, v]) => authorize.searchParams.set(k, v));
        void this.openBrowser(authorize.href).catch(() => finish(Error('로그인 브라우저를 열지 못했습니다.')));
      });
    });
    check(); const next = await this.exchange(value, { grant_type: 'authorization_code', code, redirect_uri: redirect.href }, signal); await this.save(key, next, check); return this.status(key);
  }
  async http(key: string, input: { url: string; method?: string; body?: string; headers?: Record<string, string>; authenticated?: boolean }, signal: AbortSignal): Promise<PluginHttpResult> {
    if (!input || typeof input.url !== 'string' || !['GET', 'POST'].includes(input.method ?? 'GET') || (input.body !== undefined && (typeof input.body !== 'string' || input.body.length > 1024 * 1024))) throw Error('HTTP 요청을 확인하세요.');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(input.headers ?? {})) { if (!/^[a-z0-9-]+$/i.test(k) || typeof v !== 'string' || /[\r\n]/.test(v) || /^(authorization|cookie|host|proxy-authorization|connection)$/i.test(k)) throw Error('허용되지 않은 HTTP 헤더입니다.'); headers[k] = v; }
    let sent: StoredAuth | undefined;
    const invoke = async () => {
      if (input.authenticated) { const v = await this.read(key); if (!v?.accessToken) throw Error('먼저 Notion에 연결하세요.'); if (new URL(input.url).origin !== (v.mode === 'pat' ? v.apiOrigin : v.config.apiOrigin)) throw Error('토큰은 설정한 API 서버에만 전송할 수 있습니다.'); headers.Authorization = `Bearer ${v.accessToken}`; sent = v; }
      return this.transport(input.url, { ...input, headers, signal });
    };
    let result = await invoke();
    if (input.authenticated && result.status === 401) {
      if (sent?.mode === 'pat') {
        // Keep the response a 401 so callers do not retry it as a network failure.
        if (this.memory.get(key) === sent) sent.invalid = true;
        return { status: 401, headers: {}, body: JSON.stringify({ message: 'PAT가 만료·취소되었거나 사용 권한이 변경되었습니다. 연결 설정에서 새 PAT를 입력하세요.' }) };
      }
      if (!this.refreshes.has(key)) {
        const refresh = (async () => { const v = await this.read(key); if (v?.mode === 'pat' || !v?.refreshToken || v !== sent) throw Error('인증이 변경되었거나 만료되었습니다. 다시 연결하세요.'); const revision = this.revisions.get(key); const check = () => { signal.throwIfAborted(); if (this.revisions.get(key) !== revision) throw Error('인증 설정이 변경되었습니다.'); }; const next = await this.exchange(v, { grant_type: 'refresh_token', refresh_token: v.refreshToken }, signal); await this.save(key, next, check); })();
        this.refreshes.set(key, refresh); void refresh.finally(() => this.refreshes.delete(key)).catch(() => {});
      }
      await this.refreshes.get(key); result = await invoke();
    }
    return result;
  }
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { PluginRequest, PluginManifest, PluginRecord, ScopedRequest, PluginOAuthConfig } from '@metis/contracts';
import { validPluginManifest } from '@metis/contracts';
import { checkedPath, compareVersions, digest, packageFiles, readPluginFile, writePluginFile } from './plugin-files';
import { remoteResponse, remoteText } from './plugin-network';
import { PluginAuth } from './plugin-auth';

interface Registration { enabled: boolean; source?: string }
export class PluginHost {
  private controllers = new Map<string, { owner: string; controller: AbortController }>();
  private active?: { root: string; session: ScopedRequest };
  private enabled = new Set<string>();
  private mutating = false;
  constructor(private rootFor: (r: ScopedRequest) => string, private appVersion: string, private recovery: string, private auth: PluginAuth, private selectPackage: (kind: string) => Promise<string | undefined>) {}
  reset() { for (const { controller } of this.controllers.values()) controller.abort(); this.controllers.clear(); this.enabled.clear(); this.active = undefined; }
  private async config(root: string): Promise<Record<string, Registration>> {
    const file = await checkedPath(root, '.metis/plugins.json', false, true);
    try { const data = JSON.parse(await fs.readFile(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw Error('확장 설정 파일을 읽지 못했습니다.'); }
  }
  private async saveConfig(root: string, state: Record<string, Registration>) {
    const file = await checkedPath(root, '.metis/plugins.json', true, true), tmp = file + '.' + randomUUID() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { flag: 'wx', flush: true }); await fs.rename(tmp, file);
  }
  async list(r: ScopedRequest): Promise<PluginRecord[]> {
    const root = this.rootFor(r); if (this.active?.session.workspaceId !== r.workspaceId) { this.reset(); this.active = { root, session: r }; }
    const state = await this.config(root); const records: PluginRecord[] = [];
    const folder = await checkedPath(root, '.metis/plugins', false, true);
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z][a-z0-9-]{0,50}$/.test(entry.name)) continue;
      try {
        const manifestFile = await checkedPath(root, `.metis/plugins/${entry.name}/manifest.json`, false, true);
        const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        if (!validPluginManifest(manifest) || manifest.id !== entry.name) continue;
        const compatible = compareVersions(this.appVersion, manifest.minAppVersion) >= 0;
        const enabled = compatible && state[entry.name]?.enabled === true;
        const base = `metis-plugin://${r.workspaceId}/${entry.name}/`;
        let styleUrl: string | undefined; try { const style = await checkedPath(root, `.metis/plugins/${entry.name}/styles.css`, false, true); if ((await fs.stat(style)).isFile()) styleUrl = base + 'styles.css'; } catch { /* Optional. */ }
        records.push({ ...manifest, enabled, source: state[entry.name]?.source, error: compatible ? undefined : '더 최신 Metis가 필요합니다.', entryUrl: base + 'main.js', styleUrl });
        if (enabled) this.enabled.add(entry.name); else this.enabled.delete(entry.name);
      } catch { /* An invalid manually copied package is never executed. */ }
    }
    this.rootFor(r); return records;
  }
  async assets(url: string) {
    try {
      const u = new URL(url), active = this.active;
      if (!active || u.hostname !== active.session.workspaceId) return new Response(null, { status: 404 });
      this.rootFor(active.session); const [id, ...rest] = u.pathname.slice(1).split('/');
      if (!this.enabled.has(id)) return new Response(null, { status: 403 });
      const filename = await checkedPath(active.root, `.metis/plugins/${id}/${rest.join('/')}`, false, true);
      const stat = await fs.stat(filename); if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return new Response(null, { status: 404 });
      const bytes = await fs.readFile(filename); this.rootFor(active.session);
      return new Response(bytes, { headers: { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response(null, { status: 404 }); }
  }
  async execute(r: PluginRequest): Promise<unknown> {
    const root = this.rootFor(r), owner = r.pluginId ?? '', input = (r.payload ?? {}) as Record<string, unknown>;
    if (r.operation === 'list') return this.list(r);
    if (r.operation === 'cancel') { const job = this.controllers.get(String(input.requestId)); if (job?.owner === owner) job.controller.abort(); return null; }
    if (r.operation !== 'call') {
      if (this.mutating) throw Error('다른 확장 설치 작업이 진행 중입니다.');
      this.mutating = true;
      try { return await this.mutate(r, root, input); } finally { this.mutating = false; }
    }
    if (!this.enabled.has(owner) || this.active?.session.workspaceId !== r.workspaceId) throw Error('확장이 비활성화되었거나 작업 공간이 바뀌었습니다.');
    const controller = new AbortController(); this.controllers.set(r.requestId, { owner, controller });
    const check = () => { controller.signal.throwIfAborted(); this.rootFor(r); if (!this.enabled.has(owner)) throw Error('확장이 비활성화되었습니다.'); };
    const key = `${root}\n${owner}`, payload = (input.payload ?? {}) as any;
    try {
      check(); let result: unknown;
      switch (input.action) {
        case 'http': result = await this.auth.http(key, payload, controller.signal); break;
        case 'openExternal': await this.auth.openExternal(payload.url); result = null; break;
        case 'auth.pat': result = await this.auth.connectPat(key, payload, controller.signal); break;
        case 'auth.status': result = await this.auth.status(key); break;
        case 'auth.configure': result = await this.auth.configure(key, payload as PluginOAuthConfig); break;
        case 'auth.start': result = await this.auth.start(key, controller.signal); break;
        case 'auth.disconnect': result = await this.auth.disconnect(key); break;
        case 'read': result = await readPluginFile(root, payload.path); break;
        case 'write': result = await writePluginFile(root, payload, this.recovery, check); break;
        case 'download': result = await this.download(root, payload, controller.signal, check); break;
        case 'settings.get': { const file = await checkedPath(root, `.metis/plugin-data/${owner}.json`, false, true); try { result = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; result = {}; } break; }
        case 'settings.set': { const text = JSON.stringify(payload); if (text.length > 65536) throw Error('설정 크기를 초과했습니다.'); const file = await checkedPath(root, `.metis/plugin-data/${owner}.json`, true, true); check(); const tmp = file + '.' + randomUUID() + '.tmp'; await fs.writeFile(tmp, text, { flag: 'wx', flush: true }); check(); await fs.rename(tmp, file); result = null; break; }
        default: throw Error('지원하지 않는 확장 요청입니다.');
      }
      check(); return result;
    } finally { this.controllers.delete(r.requestId); }
  }
  private async mutate(r: PluginRequest, root: string, input: Record<string, unknown>) {
    const state = await this.config(root), id = r.pluginId;
    if (r.operation === 'enable' || r.operation === 'remove') {
      if (!id || !(await this.list(r)).some(p => p.id === id)) throw Error('설치한 확장을 찾을 수 없습니다.');
      for (const job of this.controllers.values()) if (job.owner === id) job.controller.abort();
      this.enabled.delete(id);
      if (r.operation === 'remove') { const target = await checkedPath(root, `.metis/plugins/${id}`, false, true); this.rootFor(r); await fs.rm(target, { recursive: true }); delete state[id]; }
      else { if (typeof input.enabled !== 'boolean') throw Error('활성화 상태가 올바르지 않습니다.'); state[id] = { ...state[id], enabled: input.enabled }; }
      this.rootFor(r); await this.saveConfig(root, state); return this.list(r);
    }
    let source: string | Uint8Array, github: string | undefined, tag: string | undefined;
    if (r.operation === 'github') {
      github = String(input.repository ?? state[id ?? '']?.source ?? '').replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(github)) throw Error('공개 GitHub 저장소를 owner/repository 형식으로 입력하세요.');
      const signal = AbortSignal.timeout(90000);
      const release = await remoteText(`https://api.github.com/repos/${github}/releases/latest`, { signal, headers: { 'User-Agent': 'Metis-Plugin-Installer', Accept: 'application/vnd.github+json' } });
      if (release.status !== 200) throw Error(`GitHub 릴리스를 읽지 못했습니다 (${release.status}).`);
      const data = JSON.parse(release.body); tag = String(data.tag_name).replace(/^v/, '');
      const assets = (data.assets ?? []).filter((a: any) => typeof a.name === 'string' && a.name.endsWith('.zip') && (!id || a.name.startsWith(id + '-')));
      if (assets.length !== 1) throw Error('릴리스에 설치할 확장 ZIP 하나가 필요합니다.');
      const assetUrl = new URL(assets[0].browser_download_url);
      if (assetUrl.origin !== 'https://github.com' || !assetUrl.pathname.startsWith(`/${github}/releases/download/`)) throw Error('릴리스 다운로드 주소가 올바르지 않습니다.');
      const response = await remoteResponse(assetUrl.href, { signal, headers: { 'User-Agent': 'Metis-Plugin-Installer' } });
      if (response.statusCode !== 200) { response.resume(); throw Error('확장 ZIP을 다운로드하지 못했습니다.'); }
      const chunks: Buffer[] = []; let length = 0;
      for await (const bytes of response) { length += bytes.length; if (length > 64 * 1024 * 1024) { response.destroy(); throw Error('확장 ZIP이 64 MiB를 초과했습니다.'); } chunks.push(bytes); }
      source = Buffer.concat(chunks);
    } else {
      const selected = await this.selectPackage(String(input.kind ?? 'zip')); if (!selected) return this.list(r); source = selected;
    }
    this.rootFor(r);
    const { manifest, files } = await packageFiles(source);
    if (compareVersions(this.appVersion, manifest.minAppVersion) < 0 || (tag && tag !== manifest.version)) throw Error('Metis 버전 또는 릴리스 버전이 manifest와 맞지 않습니다.');
    if (id && manifest.id !== id) throw Error('업데이트 확장 ID가 다릅니다.');
    const target = await checkedPath(root, `.metis/plugins/${manifest.id}`, true, true);
    let exists = false; try { await fs.stat(target); exists = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (exists && !id) throw Error('같은 ID가 이미 설치되어 있습니다. 업데이트를 선택하세요.');
    if (id && !exists) throw Error('업데이트할 확장이 없습니다.');
    if (id) { const current = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8')) as PluginManifest; if (compareVersions(manifest.version, current.version) < 0) throw Error('이전 버전으로 업데이트할 수 없습니다.'); }
    const staging = await checkedPath(root, `.metis/staging-${randomUUID()}`, false, true); await fs.mkdir(staging);
    const previous = await checkedPath(root, `.metis/previous-${randomUUID()}`, false, true);
    let moved = false, installed = false;
    try {
      for (const [name, bytes] of files) { const file = await checkedPath(staging, name, true); await fs.writeFile(file, bytes, { flag: 'wx', flush: true }); }
      this.rootFor(r);
      for (const job of this.controllers.values()) if (job.owner === manifest.id) job.controller.abort(); this.enabled.delete(manifest.id);
      if (exists) { await fs.rename(target, previous); moved = true; }
      await fs.rename(staging, target); installed = true;
      state[manifest.id] = { enabled: state[manifest.id]?.enabled ?? false, source: github ?? state[manifest.id]?.source };
      await this.saveConfig(root, state);
      if (moved) await fs.rm(previous, { recursive: true });
    } catch (e) {
      if (installed) await fs.rm(target, { recursive: true });
      if (moved) await fs.rename(previous, target);
      await fs.rm(staging, { recursive: true, force: true }); throw e;
    }
    return this.list(r);
  }
  private async download(root: string, input: { url: string; directory: string; name: string }, signal: AbortSignal, check: () => void) {
    if (typeof input.name !== 'string' || input.name.length > 500) throw Error('첨부 이름을 확인하세요.');
    const safeName = input.name.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/[. ]+$/, '').slice(0, 80) || 'attachment';
    const temp = await checkedPath(root, `${input.directory}/.metis-${randomUUID()}.tmp`, true); check();
    const response = await remoteResponse(input.url, { signal });
    if (response.statusCode !== 200) { response.resume(); throw Error(`첨부 다운로드 실패 (${response.statusCode})`); }
    const file = await fs.open(temp, 'wx'); const hash = createHash('sha256'); let size = 0;
    try {
      for await (const bytes of response) { check(); size += bytes.length; if (size > 1024 * 1024 * 1024) { response.destroy(); throw Error('첨부 파일 한도는 1 GiB입니다.'); } hash.update(bytes); await file.writeFile(bytes); }
      await file.sync(); await file.close(); check();
      const sha = hash.digest('hex'), relativePath = `${input.directory}/${sha}-${safeName}`;
      const destination = await checkedPath(root, relativePath, true); check();
      try { await fs.link(temp, destination); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const existing = await fs.open(destination, 'r'), verify = createHash('sha256');
        try { for await (const bytes of existing.createReadStream()) { check(); verify.update(bytes); } }
        finally { await existing.close().catch(() => {}); }
        if (verify.digest('hex') !== sha) throw Error('같은 이름의 첨부가 수정되어 있습니다. 기존 파일을 보존했습니다.');
      }
      return { path: relativePath, hash: sha, bytes: size };
    } finally { response.destroy(); await file.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
  }
}

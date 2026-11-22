import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { BoundaryError, type AttachmentKind, type AttachmentRequest, type AttachmentResult, type PathRequest } from '@metis/contracts';
import type { Workspace } from './index';

const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime' };
export const attachmentMime = (name: string) => types[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
export const attachmentKind = (name: string): AttachmentKind => { const kind = attachmentMime(name).split('/')[0]; return ['image', 'audio', 'video'].includes(kind) ? kind as AttachmentKind : 'file'; };
export const attachmentCanOpen = (name: string) => (attachmentKind(name) !== 'file' && !/\.svg$/i.test(name)) || /\.(pdf|txt|csv|zip|7z|tar|gz|docx|xlsx|pptx|odt|ods|odp|rtf)$/i.test(name);
const empty = (): AttachmentResult => ({ files: [], errors: [], resources: [] });
const message = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return '첨부파일을 찾을 수 없습니다.';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return '첨부파일에 접근할 권한이 없습니다.';
  if (code) return '첨부파일을 읽거나 복사하지 못했습니다.';
  return e instanceof Error ? e.message : '첨부파일 처리 실패';
};
export function attachmentTarget(document: string, target: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(target.split('#')[0]); } catch { throw new Error('잘못된 첨부 경로 인코딩입니다.'); }
  if (!decoded || /[\\:\x00-\x1f?]/.test(decoded) || decoded.startsWith('/')) throw new Error('로컬 상대 첨부 경로만 지원합니다.');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(document), decoded));
  if (resolved === '..' || resolved.startsWith('../')) throw new Error('작업 공간 밖의 첨부입니다.');
  return resolved;
}
export async function attachmentPath(root: string, relative: string): Promise<string> {
  if (!relative || relative.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git' || /[\\:\x00-\x1f]/.test(p))) throw new Error('허용되지 않는 첨부 경로입니다.');
  let candidate = root;
  for (const part of relative.split('/')) {
    candidate = path.join(candidate, part);
    if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error('심볼릭 링크·junction 첨부는 지원하지 않습니다.');
  }
  const real = await fs.realpath(candidate), rel = path.relative(root, real);
  if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) throw new Error('작업 공간 밖의 첨부입니다.');
  return real;
}
interface Resource { scope: PathRequest; relativePath: string; group: string }
async function sourceRelativePath(root: string, input: string): Promise<string | undefined> {
  // File pickers may use /var, Windows short names, or an alias of the workspace.
  // Find that root while preserving child components for attachmentPath's link checks.
  let parent = path.dirname(input), relative = path.basename(input), match: string | undefined;
  for (;;) {
    if (path.relative(root, await fs.realpath(parent)) === '') match = relative;
    const next = path.dirname(parent);
    if (next === parent) return match;
    relative = `${path.basename(parent)}/${relative}`; parent = next;
  }
}
export class Attachments {
  private resources = new Map<string, Resource>();
  constructor(private workspace: Workspace) {}
  clear() { this.resources.clear(); }
  release(group: string) { for (const [key, value] of this.resources) if (value.group === group) this.resources.delete(key); }
  async register(request: AttachmentRequest): Promise<AttachmentResult> {
    const root = this.workspace.analysisRoot(request), result = empty(), group = randomUUID(); result.group = group;
    for (const target of [...new Set(request.targets)]) {
      try {
        const relativePath = attachmentTarget(request.relativePath, target), file = await attachmentPath(root, relativePath);
        if (!(await fs.stat(file)).isFile()) throw new Error('일반 파일만 첨부할 수 있습니다.');
        this.workspace.analysisRoot(request);
        if (this.resources.size >= 10000) throw new Error('열린 첨부 리소스 한도를 초과했습니다.');
        const token = randomUUID(), kind = attachmentKind(file);
        this.resources.set(token, { scope: { requestId: request.requestId, workspaceId: request.workspaceId, workspaceEpoch: request.workspaceEpoch, relativePath: request.relativePath }, relativePath, group });
        result.resources.push({ target, token, kind, url: `metis-attachment://resource/${token}` });
      } catch (error) { result.resources.push({ target, error: message(error) }); }
    }
    return result;
  }
  async resolveToken(token: string, request?: PathRequest) {
    const resource = this.resources.get(token);
    if (!resource || (request && (request.workspaceId !== resource.scope.workspaceId || request.workspaceEpoch !== resource.scope.workspaceEpoch || request.relativePath !== resource.scope.relativePath))) throw new Error('첨부 리소스가 만료되었습니다.');
    const root = this.workspace.analysisRoot(resource.scope), file = await attachmentPath(root, resource.relativePath);
    this.workspace.analysisRoot(resource.scope);
    if (!(await fs.stat(file)).isFile()) throw new Error('일반 파일이 아닙니다.');
    return file;
  }
  async response(url: string, range: string | null, method = 'GET'): Promise<Response> {
    try {
      const parsed = new URL(url);
      if (parsed.host !== 'resource' || parsed.search || parsed.hash || !/^\/[\w-]+$/.test(parsed.pathname) || !['GET', 'HEAD'].includes(method)) return new Response(null, { status: 400 });
      const file = await this.resolveToken(parsed.pathname.slice(1)), mime = attachmentMime(file);
      if (mime === 'application/octet-stream') return new Response(null, { status: 415 });
      const handle = await fs.open(file, 'r');
      try {
        const stat = await handle.stat(), size = stat.size;
        if (!stat.isFile()) throw new Error('일반 파일이 아닙니다.');
        let start = 0, end = size - 1, status = 200;
        const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; sandbox" };
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) { await handle.close(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); }
          start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { await handle.close(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['Content-Length'] = String(Math.max(0, end - start + 1));
        if (method === 'HEAD' || !size) { await handle.close(); return new Response(null, { status, headers }); }
        return new Response(Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream<Uint8Array>, { status, headers });
      } catch (error) { await handle.close(); throw error; }
    } catch { return new Response(null, { status: 404 }); }
  }
  async import(request: AttachmentRequest): Promise<AttachmentResult> {
    if ((request.sources?.length ?? 0) > 50) throw new BoundaryError('TOO_LARGE', '한 번에 50개까지 첨부할 수 있습니다.');
    const root = this.workspace.analysisRoot(request), doc = await this.workspace.read(request), result = empty();
    if (doc.readOnly || doc.eol === 'mixed') throw new BoundaryError('ACCESS_DENIED', '읽기 전용 문서에는 첨부를 추가할 수 없습니다.');
    const folder = path.posix.join(path.posix.dirname(request.relativePath), 'assets');
    for (const source of request.sources ?? []) {
      try {
        this.workspace.analysisRoot(request);
        let input: string | undefined, bytes: Buffer | undefined, name = `image-${Date.now()}.png`;
        if (source.path) {
          input = path.resolve(source.path); const stat = await fs.lstat(input);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 * 1024) throw new Error('1 GiB 이하의 일반 파일만 가져올 수 있습니다.');
          const rel = await sourceRelativePath(root, input);
          if (rel) {
            await attachmentPath(root, rel); this.workspace.analysisRoot(request); result.files.push({ relativePath: rel, kind: attachmentKind(input) }); continue;
          }
          name = path.basename(input);
        } else {
          bytes = Buffer.from(source.png ?? []);
          if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('PNG 이미지 데이터가 아닙니다.');
        }
        const parent = path.posix.dirname(request.relativePath);
        const parentPath = parent === '.' ? root : await attachmentPath(root, parent);
        await fs.mkdir(path.join(parentPath, 'assets')).catch(e => { if (e.code !== 'EEXIST') throw e; });
        await attachmentPath(root, folder);
        name = name.replace(/[<>:"/\\|?*\x00-\x1f\[\]{}#%]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || 'attachment';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
        let copied = false;
        for (let n = 0; n < 10000; n++) {
          const ext = path.extname(name), filename = n ? `${name.slice(0, name.length - ext.length)}-${n}${ext}` : name;
          const relativePath = path.posix.join(folder, filename), destination = path.join(await attachmentPath(root, folder), filename);
          this.workspace.analysisRoot(request);
          try { if (input) await fs.copyFile(input, destination, constants.COPYFILE_EXCL); else await fs.writeFile(destination, bytes!, { flag: 'wx' }); }
          catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
          result.files.push({ relativePath, kind: attachmentKind(filename) }); copied = true; break;
        }
        if (!copied) throw new Error('첨부 파일 이름 충돌이 너무 많습니다.');
      } catch (error) { result.errors.push(`${source.path ? path.basename(source.path) : '붙여넣기 이미지'}: ${message(error)}`); }
    }
    return result;
  }
}

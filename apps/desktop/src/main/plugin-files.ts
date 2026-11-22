import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { BoundaryError, validPluginManifest, type PluginManifest } from '@metis/contracts';
import { guardedSave } from '../../../../packages/workspace/src/save';

export const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export function relativeName(name: unknown, internal = false): asserts name is string {
  if (typeof name !== 'string' || !name || name.length > 4096 || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(s => !s || s === '.' || s === '..' || /[<>"|?*]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s) || s.toLowerCase() === '.git' || (!internal && s.toLowerCase() === '.metis'))) throw new BoundaryError('INVALID_REQUEST', '안전한 작업 공간 상대 경로가 필요합니다.');
}
export async function checkedPath(root: string, name: string, createParents = false, internal = false): Promise<string> {
  relativeName(name, internal);
  const parts = name.split('/'); let current = await fs.realpath(root);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new BoundaryError('OUTSIDE_WORKSPACE', '링크 또는 일반 폴더가 아닌 경로를 사용할 수 없습니다.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (i < parts.length - 1 && createParents) await fs.mkdir(current); }
  }
  return current;
}
export async function readPluginFile(root: string, name: string) {
  const target = await checkedPath(root, name);
  try { const stat = await fs.stat(target); if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('파일 읽기 한도는 16 MiB입니다.'); const data = await fs.readFile(target); return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), hash: digest(data) }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function writePluginFile(root: string, payload: { path: string; text: string; expectedHash?: string }, recovery: string, check: () => void) {
  if (typeof payload.text !== 'string' || !payload.text.isWellFormed() || payload.text.includes('\0') || Buffer.byteLength(payload.text) > 16 * 1024 * 1024 || (payload.expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(payload.expectedHash))) throw Error('파일 내용 또는 기준 해시가 올바르지 않습니다. (최대 16 MiB)');
  check(); const target = await checkedPath(root, payload.path, true); check();
  const bytes = Buffer.from(payload.text);
  if (payload.expectedHash !== undefined) await guardedSave(target, payload.expectedHash, bytes, recovery, async () => { check(); await checkedPath(root, payload.path); });
  else {
    const temporary = path.join(path.dirname(target), `.metis-${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, bytes, { flag: 'wx', flush: true }); check(); await checkedPath(root, payload.path); await fs.link(temporary, target); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }
  check(); return { hash: digest(bytes) };
}
export function compareVersions(a: string, b: string) { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }
export async function packageFiles(source: string | Uint8Array) {
  if (typeof source === 'string' && (await fs.lstat(source)).isSymbolicLink()) throw Error('링크 패키지는 설치할 수 없습니다.');
  const files = new Map<string, Uint8Array>(); let total = 0;
  const add = (name: string, bytes: Uint8Array) => {
    relativeName(name); if (name.split('/').some(p => p.startsWith('.')) || files.size >= 256 || bytes.byteLength > 16 * 1024 * 1024 || (total += bytes.byteLength) > 64 * 1024 * 1024) throw Error('확장 패키지의 파일 수·크기·경로 제한을 초과했습니다.');
    if ([...files.keys()].some(k => k.toLowerCase() === name.toLowerCase())) throw Error('중복 패키지 경로입니다.'); files.set(name, bytes);
  };
  if (typeof source === 'string' && (await fs.lstat(source)).isDirectory()) {
    const walk = async (folder: string, prefix = '') => {
      for (const e of await fs.readdir(folder, { withFileTypes: true })) {
        const name = prefix + e.name; relativeName(name);
        if (e.isSymbolicLink()) throw Error('링크 파일은 설치할 수 없습니다.');
        if (e.isDirectory()) { if (name.split('/').length > 8) throw Error('패키지 경로가 너무 깊습니다.'); await walk(path.join(folder, e.name), name + '/'); }
        else if (e.isFile()) { if ((await fs.stat(path.join(folder, e.name))).size > 16 * 1024 * 1024) throw Error('패키지 파일이 너무 큽니다.'); add(name, await fs.readFile(path.join(folder, e.name))); }
        else throw Error('일반 파일만 설치할 수 있습니다.');
      }
    }; await walk(source);
  } else {
    const bytes = typeof source === 'string' ? await fs.readFile(source) : source;
    if (bytes.byteLength > 64 * 1024 * 1024) throw Error('ZIP은 64 MiB 이하여야 합니다.');
    let advertised = 0, count = 0;
    const entries = unzipSync(bytes, { filter: file => { if (file.name.endsWith('/')) return false; relativeName(file.name); if (++count > 256 || file.originalSize > 16 * 1024 * 1024 || (advertised += file.originalSize) > 64 * 1024 * 1024) throw Error('ZIP 압축 해제 한도를 초과했습니다.'); return true; } });
    for (const [name, bytes] of Object.entries(entries)) add(name, bytes);
  }
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  if (!validPluginManifest(manifest) || !files.has('main.js')) throw Error('SDK 1 manifest.json과 ESM main.js가 필요합니다.');
  return { files, manifest: manifest as PluginManifest };
}

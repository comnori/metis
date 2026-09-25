import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BoundaryError, type RecoveryEntry, type RecoveryList, type RecoveryContent, type RecoveryRequest } from '@metis/contracts';
export class Recovery {
  constructor(private directory: string) {}
  private async file(id: string, name: string, limit: number) {
    if (!/^(save|draft)-[\w-]{1,80}$/.test(id)) throw new BoundaryError('INVALID_REQUEST', '복구 식별자를 확인해 주세요.');
    const root = await fs.realpath(this.directory);
    const folder = path.join(root, id), target = path.join(folder, name);
    if ((await fs.lstat(folder)).isSymbolicLink() || (await fs.lstat(target)).isSymbolicLink()) throw new BoundaryError('ACCESS_DENIED', '복구 링크는 읽을 수 없습니다.');
    if (await fs.realpath(folder) !== folder || path.dirname(await fs.realpath(target)) !== folder) throw new BoundaryError('ACCESS_DENIED', '복구 경로가 변경되었습니다.');
    const handle = await fs.open(target, 'r');
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw new BoundaryError('TOO_LARGE', '복구 파일 크기를 확인해 주세요.');
      const bytes = Buffer.alloc(stat.size + 1); let bytesRead = 0;
      while (bytesRead < bytes.length) { const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead); if (!chunk.bytesRead) break; bytesRead += chunk.bytesRead; }
      const after = await handle.stat();
      if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new BoundaryError('CHANGED_DURING_READ', '복구 사본이 변경되었습니다.');
      return bytes.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  private async metadata(root: string, id: string) {
    const data = JSON.parse((await this.file(id, 'transaction.json', 16384)).toString('utf8'));
    if (typeof data.target !== 'string' || !path.isAbsolute(data.target)) throw new Error('Invalid metadata');
    const relative = path.relative(root, data.target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !/\.adoc$/i.test(relative)) throw new BoundaryError('OUTSIDE_WORKSPACE', '현재 작업 공간의 복구 사본이 아닙니다.');
    return relative.replaceAll(path.sep, '/');
  }
  async list(root: string): Promise<RecoveryList> {
    let folders;
    try { folders = await fs.readdir(this.directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] }; throw error; }
    const entries: RecoveryEntry[] = []; let skipped = false;
    for (const folder of folders.slice(0, 1000)) {
      if (!folder.isDirectory() || folder.isSymbolicLink() || !/^(save|draft)-[\w-]+$/.test(folder.name)) continue;
      try {
        const relativePath = await this.metadata(root, folder.name);
        const variants: RecoveryEntry['variants'] = [];
        for (const variant of ['before', 'edited', 'displaced'] as const) {
          const stat = await fs.lstat(path.join(this.directory, folder.name, `${variant}.adoc`)).catch(() => undefined);
          if (stat?.isFile() && !stat.isSymbolicLink()) variants.push(variant);
        }
        const stat = await fs.stat(path.join(this.directory, folder.name, 'transaction.json'));
        const completed = await fs.lstat(path.join(this.directory, folder.name, 'completed')).catch(() => undefined);
        entries.push({ id: folder.name, relativePath, variants, createdAt: stat.mtime.toISOString(), state: folder.name.startsWith('draft-') ? 'draft' : completed?.isFile() ? 'saved' : 'incomplete' });
      } catch (error) { if (!(error instanceof BoundaryError && error.code === 'OUTSIDE_WORKSPACE')) skipped = true; }
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { entries: entries.slice(0, 200), warning: skipped || folders.length > 1000 || entries.length > 200 ? '손상·읽기 실패 또는 목록 한도로 일부 복구 사본을 표시하지 못했습니다. 복구 폴더에서 확인할 수 있습니다.' : undefined };
  }
  async read(root: string, id: string, variant: RecoveryRequest['variant']): Promise<RecoveryContent> {
    if (!['before', 'edited', 'displaced'].includes(variant)) throw new BoundaryError('INVALID_REQUEST', '복구 종류를 확인해 주세요.');
    const relativePath = await this.metadata(root, id);
    const bytes = await this.file(id, `${variant}.adoc`, 16 * 1024 * 1024);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new BoundaryError('UNSUPPORTED_FILE', '텍스트 복구 사본이 아닙니다.');
    return { relativePath, text };
  }
  async checkpoint(target: string, text: string, retained?: string) {
    const bytes = Buffer.from(text); if (bytes.length > 16 * 1024 * 1024) throw new BoundaryError('TOO_LARGE', '보존 한도는 16 MiB입니다.');
    await fs.mkdir(this.directory, { recursive: true });
    const folder = await fs.mkdtemp(path.join(this.directory, 'draft-'));
    await fs.writeFile(path.join(folder, 'edited.adoc'), bytes, { flag: 'wx', flush: true });
    await fs.writeFile(path.join(folder, 'transaction.json'), JSON.stringify({ target, retained }), { flag: 'wx', flush: true });
    return path.basename(folder);
  }
}

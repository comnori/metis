import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Draft, DraftWriteRequest, PathRequest } from '@metis/contracts';

export class Drafts {
  constructor(private directory: string) {}

  private file(viewKey: string, relativePath: string) {
    const documentKey = createHash('sha256').update(relativePath).digest('hex');
    return path.join(this.directory, viewKey, `${documentKey}.json`);
  }

  async write(viewKey: string, request: DraftWriteRequest): Promise<null> {
    const target = this.file(viewKey, request.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const draft: Draft = { relativePath: request.relativePath, text: request.text, revision: request.revision, updatedAt: new Date().toISOString() };
    try {
      await fs.writeFile(temporary, JSON.stringify(draft), { flag: 'wx', flush: true });
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return null;
  }

  async read(viewKey: string, request: PathRequest): Promise<Draft | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.file(viewKey, request.relativePath), 'utf8')) as Partial<Draft>;
      if (value.relativePath !== request.relativePath || typeof value.text !== 'string' || value.text.length > 16 * 1024 * 1024 || value.text.includes('\0') || !value.text.isWellFormed() || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.updatedAt !== 'string') return null;
      return value as Draft;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async delete(viewKey: string, request: PathRequest): Promise<null> {
    await fs.unlink(this.file(viewKey, request.relativePath)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    return null;
  }
}

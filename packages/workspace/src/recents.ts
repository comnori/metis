import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoundaryError, type RecentWorkspace, type RecentList } from '@metis/contracts';
type Stored = Omit<RecentWorkspace, 'state'>;
export class Recents {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private async load(): Promise<Stored[]> {
    let raw: string;
    try { raw = await fs.readFile(this.file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 20 || !data.every(e => e &&
      typeof e.id === 'string' && /^[\w-]{1,80}$/.test(e.id) && typeof e.name === 'string' &&
      typeof e.path === 'string' && path.isAbsolute(e.path) && typeof e.openedAt === 'string')) throw new Error('Invalid recent workspace store');
    return data;
  }
  private update(change: (entries: Stored[]) => Stored[] | Promise<Stored[]>) {
    const operation = this.queue.then(async () => {
      const entries = await change(await this.load());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(entries, null, 2), { flag: 'wx' }); await fs.rename(temporary, this.file); }
      finally { await fs.unlink(temporary).catch(() => {}); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async record(root: string) {
    const key = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
    await this.update(async entries => {
      const resolved = await fs.realpath(root);
      const prior = entries.find(e => key(e.path) === key(resolved));
      return [{ id: prior?.id ?? randomUUID(), name: path.basename(resolved) || resolved, path: resolved, openedAt: new Date().toISOString() },
        ...entries.filter(e => key(e.path) !== key(resolved))].slice(0, 20);
    });
  }
  async resolve(id: string): Promise<string> {
    await this.queue;
    const entry = (await this.load()).find(e => e.id === id);
    if (!entry) throw new BoundaryError('NOT_FOUND', '최근 작업 공간을 찾을 수 없습니다.');
    return entry.path;
  }
  remove(id: string) { return this.update(entries => entries.filter(e => e.id !== id)); }
  async list(): Promise<RecentList> {
    await this.queue;
    try {
      const entries = await this.load();
      return { entries: await Promise.all(entries.map(async entry => {
        let state: RecentWorkspace['state'] = 'available';
        try { await fs.readdir(entry.path); }
        catch (error) { state = ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'unavailable'; }
        return { ...entry, state };
      })) };
    } catch { return { entries: [], warning: '최근 작업 공간 기록을 읽지 못했습니다. 폴더 열기는 계속 사용할 수 있습니다.' }; }
  }
}

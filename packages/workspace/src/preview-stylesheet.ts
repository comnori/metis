import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BoundaryError, type PreviewStylesheet } from '@metis/contracts';

const limit = 256 * 1024;
type Store = Record<string, string>;

export function validatePreviewCss(bytes: Buffer): { css?: string; warning?: string } {
  if (bytes.length > limit) return { warning: '사용자 CSS는 256 KiB 이하만 사용할 수 있습니다. 내장 테마를 사용합니다.' };
  let css: string;
  try { css = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { warning: '사용자 CSS는 UTF-8 파일이어야 합니다. 내장 테마를 사용합니다.' }; }
  if (css.includes('\0') || /@import\b|url\s*\(/i.test(css)) return { warning: '외부 자원을 불러오는 CSS 구문은 사용할 수 없습니다. 내장 테마를 사용합니다.' };
  return { css };
}

export class PreviewStylesheets {
  constructor(private storePath: string) {}
  private async load(): Promise<Store> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.storePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.entries(parsed).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || typeof value !== 'string' || !path.isAbsolute(value))) throw Error();
      return parsed as Store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new BoundaryError('INTERNAL_ERROR', '사용자 CSS 설정을 읽지 못했습니다.');
    }
  }
  private async save(value: Store) {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', flush: true }); await fs.rename(temporary, this.storePath); }
    catch (error) { try { await fs.unlink(temporary); } catch { /* best effort */ } throw error; }
  }
  async select(viewKey: string, selectedPath: string): Promise<PreviewStylesheet> {
    const resolved = await fs.realpath(selectedPath);
    const store = await this.load(); store[viewKey] = resolved; await this.save(store);
    return this.read(viewKey);
  }
  async clear(viewKey: string): Promise<PreviewStylesheet> {
    const store = await this.load(); delete store[viewKey]; await this.save(store); return { active: false };
  }
  async read(viewKey: string): Promise<PreviewStylesheet> {
    const selected = (await this.load())[viewKey];
    if (!selected) return { active: false };
    const name = path.basename(selected);
    try {
      const stat = await fs.stat(selected);
      if (!stat.isFile()) return { name, active: false, warning: '연결한 사용자 CSS가 일반 파일이 아닙니다. 내장 테마를 사용합니다.' };
      const result = validatePreviewCss(stat.size > limit ? Buffer.alloc(limit + 1) : await fs.readFile(selected));
      return result.css === undefined ? { name, active: false, warning: result.warning } : { name, css: result.css, active: true };
    } catch {
      return { name, active: false, warning: '연결한 사용자 CSS를 읽지 못했습니다. 내장 테마를 사용합니다.' };
    }
  }
}

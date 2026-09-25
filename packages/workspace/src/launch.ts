import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoundaryError, validate } from '@metis/contracts';
export interface LaunchTarget { root: string; relativePath: string; line: number }
export function parseLaunch(args: string[], cwd: string): LaunchTarget | undefined {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') continue;
    if (!['--workspace', '--file', '--line'].includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new BoundaryError('INVALID_REQUEST', 'CLI 형식: --workspace <폴더> [--file <상대 .adoc 경로> --line <줄>]');
    values.set(args[i], args[++i]);
  }
  if (!values.size) return;
  const root = values.get('--workspace'), relativePath = (values.get('--file') ?? '').replaceAll('\\', '/'), lineText = values.get('--line') ?? '1';
  if (!root || root.length > 4096 || /[\x00-\x1f]/.test(root) || !/^\d{1,7}$/.test(lineText) || Number(lineText) < 1 || Number(lineText) > 1000000 || (values.has('--line') && !relativePath)) throw new BoundaryError('INVALID_REQUEST', 'CLI 폴더·문서·줄 번호를 확인하세요.');
  if (relativePath) { validate('readDocument', { requestId: 'cli', workspaceId: 'cli', workspaceEpoch: 1, relativePath }); if (!/\.adoc$/i.test(relativePath) || relativePath.split('/').some(part => part.toLowerCase() === '.git')) throw new BoundaryError('INVALID_REQUEST', '작업 공간 안의 AsciiDoc 문서만 지정하세요.'); }
  return { root: path.resolve(cwd, root), relativePath, line: Number(lineText) };
}
export class LaunchQueue {
  private items: Array<{ id: string; target?: LaunchTarget; error?: string }> = [];
  add(args: string[], cwd: string) {
    if (this.items.length >= 10) return false;
    try { const target = parseLaunch(args, cwd); if (target) this.items.push({ id: randomUUID(), target }); }
    catch (error) { this.items.push({ id: randomUUID(), error: error instanceof Error ? error.message : 'CLI 요청을 확인하세요.' }); }
    return true;
  }
  peek() { return this.items[0]; }
  take(id: string) { const item = this.items[0]; if (!item || item.id !== id) throw new BoundaryError('INVALID_REQUEST', 'CLI 요청이 만료되었습니다.'); this.items.shift(); return item; }
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BoundaryError } from '@metis/contracts';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function guardedSave(target: string, expected: string, next: Buffer, recoveryRoot: string, revalidate: () => Promise<void>) {
  const before = await fs.readFile(target);
  if (hash(before) !== expected) throw new BoundaryError('CONFLICT', '외부에서 문서가 변경되었습니다. 편집 내용을 유지했습니다.');
  if (before.equals(next)) return;
  const transaction = await fs.mkdtemp(path.join(await fs.mkdir(recoveryRoot, { recursive: true }).then(() => recoveryRoot), 'save-'));
  const token = randomUUID();
  const temporary = path.join(path.dirname(target), `.metis-${token}.tmp`);
  const displaced = path.join(path.dirname(target), `.metis-${token}.original`);
  // Persist both versions before moving the original. Journals are retained for manual recovery.
  await fs.writeFile(path.join(transaction, 'before.adoc'), before, { flag: 'wx', flush: true });
  await fs.writeFile(path.join(transaction, 'edited.adoc'), next, { flag: 'wx', flush: true });
  await fs.writeFile(path.join(transaction, 'transaction.json'), JSON.stringify({ target, temporary, displaced, expected }, null, 2), { flag: 'wx', flush: true });
  let moved = false;
  let committed = false;
  try {
    const stat = await fs.stat(target);
    await fs.writeFile(temporary, next, { flag: 'wx', mode: stat.mode, flush: true });
    await revalidate();
    if (hash(await fs.readFile(target)) !== expected) throw new BoundaryError('CONFLICT', '저장 중 원본이 변경되었습니다. 편집 내용을 유지했습니다.');
    await fs.rename(target, displaced); moved = true;
    if ((await fs.lstat(displaced)).isSymbolicLink()) throw new BoundaryError('CONFLICT', '교체 중 경로가 링크로 변경되었습니다.');
    const captured = await fs.readFile(displaced);
    await fs.writeFile(path.join(transaction, 'displaced.adoc'), captured, { flag: 'wx', flush: true });
    if (hash(captured) !== expected) throw new BoundaryError('CONFLICT', '교체 직전의 외부 변경을 감지했습니다. 복구 사본을 보존했습니다.');
    // link publishes a complete file without replacing a concurrently created target.
    await fs.link(temporary, target); committed = true;
    if (hash(await fs.readFile(target)) !== hash(next)) throw new BoundaryError('CONFLICT', '저장 직후 외부 변경을 감지했습니다. 두 버전을 복구 위치에 보존했습니다.');
    await fs.writeFile(path.join(transaction, 'completed'), '', { flag: 'wx', flush: true });
  } catch (error) {
    if (moved && !committed) {
      try { await fs.link(displaced, target); }
      catch { /* Never replace a concurrent target; displaced remains available for recovery. */ }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BoundaryError('CONFLICT', '저장 위치에 다른 파일이 생겼습니다. 원본과 편집 사본을 보존했습니다.');
    throw error;
  } finally {
    await fs.unlink(temporary).catch(() => {});
    // Retain the displaced inode: a pre-existing writer may still hold it open.
    // Its location is recorded in transaction.json, even following a crash.
  }
}

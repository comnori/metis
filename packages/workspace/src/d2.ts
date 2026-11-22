import { promises as fs } from 'node:fs';
import { BoundaryError, validate, type PathRequest } from '@metis/contracts';
import { attachmentPath } from './attachments';
import type { Workspace } from './index';

// Only explicitly requested D2 dependencies are read; never enumerate a workspace.
export async function readD2File(workspace: Workspace, request: PathRequest): Promise<Uint8Array> {
  validate('readD2File', request);
  const root = workspace.analysisRoot(request);
  const target = await attachmentPath(root, request.relativePath);
  const handle = await fs.open(target, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 8 * 1024 * 1024) throw new BoundaryError('TOO_LARGE', 'D2 의존 파일은 일반 파일, 개별 8 MiB까지 지원합니다.');
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const chunk = await handle.read(bytes, count, bytes.length - count, count);
      if (!chunk.bytesRead) break;
      count += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new BoundaryError('CHANGED_DURING_READ', 'D2 의존 파일이 변경되었습니다. 다시 미리보기하세요.');
    if (await attachmentPath(root, request.relativePath) !== target) throw new BoundaryError('OUTSIDE_WORKSPACE', 'D2 의존 파일 경로가 변경되었습니다.');
    workspace.analysisRoot(request);
    return new Uint8Array(bytes.subarray(0, count));
  } finally { await handle.close(); }
}

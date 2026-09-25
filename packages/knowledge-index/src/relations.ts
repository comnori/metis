import path from 'node:path';
import { Workspace } from '@metis/workspace';
import { analyze } from '@metis/document-core';
import { BoundaryError, type Relation, type RelationIndex, type DocumentSnapshot } from '@metis/contracts';

function targetPath(edge: Relation, documentPath: string): string | undefined {
  if (edge.destination) return edge.destination.relativePath;
  if (/[\\:\x00-\x1f%{}]/.test(edge.target) || edge.target.startsWith('/')) return;
  const hash = edge.target.indexOf('#');
  const file = hash >= 0 ? edge.target.slice(0, hash) : /\.adoc$/i.test(edge.target) || edge.kind === 'include' ? edge.target : '';
  const resolved = file ? path.posix.normalize(path.posix.join(path.posix.dirname(edge.relativePath), file)) : documentPath;
  return resolved === '..' || resolved.startsWith('../') ? undefined : resolved;
}

// A fresh, bounded saved-file snapshot is rebuilt on each request. No derived
// state survives a request, so deletion and reconstruction cannot retain old edges.
export async function buildRelations(root: string): Promise<RelationIndex> {
  const workspace = new Workspace(), session = await workspace.open(root);
  const scope = { requestId: 'relations', ...session };
  const result: RelationIndex = { edges: [], documents: [], scanned: 0, partial: false, warnings: [], completedAt: '' };
  const warn = (message: string) => { result.partial = true; if (result.warnings.length < 20 && !result.warnings.includes(message)) result.warnings.push(message); };
  const started = Date.now(), expired = () => Date.now() - started > 8000;
  async function paths() {
    const found: string[] = [], queue = ['']; let directories = 0;
    while (queue.length && directories++ < 128 && found.length < 200 && !expired()) {
      const directory = queue.shift()!;
      try {
        for (const entry of await workspace.list({ ...scope, relativePath: directory })) {
          if (entry.name.startsWith('.')) continue;
          if (entry.kind === 'directory') queue.push(entry.relativePath);
          else if (found.length < 200) found.push(entry.relativePath);
          else { warn('문서 200개 한도: 일부 작업 공간만 조사합니다.'); break; }
        }
      } catch { warn(`${directory || '/'}: 폴더 접근 실패`); }
    }
    if (queue.length || expired()) warn('폴더·시간 한도: 전체 작업 공간을 조사하지 못했습니다.');
    return found.sort();
  }
  const files = await paths(), snapshots = new Map<string, DocumentSnapshot>(); let bytes = 0;
  result.documents = files;
  for (const relativePath of files) {
    if (expired()) { warn('조사 시간 한도에 도달했습니다.'); break; }
    try {
      const file = await workspace.read({ ...scope, relativePath }); bytes += file.byteLength;
      if (bytes > 32 * 1024 * 1024) { warn('원문 32 MiB 한도에 도달했습니다.'); break; }
      snapshots.set(relativePath, file);
    } catch { warn(`${relativePath}: 읽기 실패`); }
  }
  for (const [documentPath, file] of snapshots) {
    if (result.scanned >= 50 || result.edges.length >= 2000 || expired()) { warn('해석 50개·관계 2,000개·시간 한도: 일부 결과입니다.'); break; }
    try {
      const analysis = await analyze(root, documentPath, file.text);
      result.scanned++;
      if (analysis.diagnostics.length) warn(`${documentPath}: 해석 진단이 있습니다. 결과가 불완전할 수 있습니다.`);
      for (const edge of analysis.relations) {
        if (edge.sourceUncertain) { warn(`${documentPath}: 정확한 출처가 불명확한 참조를 제외했습니다.`); continue; }
        if (result.edges.length >= 2000) { warn('관계 2,000개 한도에 도달했습니다.'); break; }
        if (!snapshots.has(edge.relativePath)) warn('일부 포함 출처는 원문 기준을 재확인하지 못했습니다.');
        if (edge.destination && !snapshots.has(edge.destination.relativePath)) warn('일부 대상 문서는 최종 리비전 확인 범위 밖입니다.');
        if (edge.state === 'unchecked') warn('대상 해석 한도로 확인하지 못한 참조가 있습니다.');
        result.edges.push({ ...edge, documentPath, targetPath: targetPath(edge, documentPath), revision: snapshots.get(edge.relativePath)?.revision });
      }
    } catch { warn(`${documentPath}: 해석 실패`); }
  }
  // Do not publish a mixture of revisions when files changed during analysis.
  // The final check does not promise an atomic filesystem snapshot.
  if (!expired()) {
    const current = await paths();
    if (JSON.stringify(current) !== JSON.stringify(files)) throw new BoundaryError('CONFLICT', '조사 중 파일 목록이 변경되었습니다. 다시 조사해 주세요.');
    for (const [relativePath, file] of snapshots) {
      if (expired()) { warn('일부 원문의 최종 리비전을 확인하지 못했습니다.'); break; }
      let currentFile;
      try { currentFile = await workspace.read({ ...scope, relativePath }); } catch { throw new BoundaryError('CONFLICT', '조사 중 문서가 변경·삭제되었습니다. 다시 조사해 주세요.'); }
      if (currentFile.revision !== file.revision) throw new BoundaryError('CONFLICT', '조사 중 문서가 변경되었습니다. 다시 조사해 주세요.');
    }
  } else warn('조사 시간 한도로 최종 리비전을 확인하지 못했습니다.');
  result.completedAt = new Date().toISOString();
  return result;
}

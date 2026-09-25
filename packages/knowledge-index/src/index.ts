import { Workspace } from '@metis/workspace';
import { analyze } from '@metis/document-core';
import type { SearchRequest, SearchResults, SearchHit } from '@metis/contracts';
// Each request reads saved files anew; no persistent index can silently become stale.
export async function search(root: string, request: SearchRequest): Promise<SearchResults> {
  const workspace = new Workspace(), session = await workspace.open(root);
  const result: SearchResults = { hits: [], scanned: 0, partial: false, warnings: [], completedAt: '' };
  const warn = (message: string) => { result.partial = true; if (result.warnings.length < 20) result.warnings.push(message); };
  const query = request.caseSensitive ? request.query : request.query.toLowerCase();
  const matches = (text: string) => (request.caseSensitive ? text : text.toLowerCase()).includes(query);
  if (!query && request.mode !== 'files') return { ...result, completedAt: new Date().toISOString() };
  const queue = [''], started = Date.now(); let directories = 0, bytes = 0, documents = 0;
  const limited = () => Date.now() - started > 8000 || result.hits.length >= 500 || documents >= (request.mode === 'symbols' ? 50 : 500) || bytes > 32 * 1024 * 1024;
  const read = (relativePath: string) => workspace.read({ requestId: 'search-read', ...session, relativePath });
  while (queue.length && directories < 128 && !limited()) {
    const directory = queue.shift()!; directories++;
    try {
      for (const entry of await workspace.list({ requestId: 'search-list', ...session, relativePath: directory })) {
        if (limited()) { warn('검색 한도에 도달했습니다. 일부 결과만 표시합니다.'); break; }
        if (entry.name.startsWith('.')) continue;
        if (entry.kind === 'directory') { queue.push(entry.relativePath); continue; }
        documents++;
        if (request.mode === 'files') {
          result.scanned++;
          if (matches(entry.relativePath)) result.hits.push({ kind: 'file', label: entry.name, context: entry.relativePath, relativePath: entry.relativePath, documentPath: entry.relativePath, line: 1 });
          continue;
        }
        try {
          const snapshot = await read(entry.relativePath); bytes += snapshot.byteLength;
          if (bytes > 32 * 1024 * 1024) { warn('검색 원문 합계 32 MiB 한도에 도달했습니다.'); break; }
          result.scanned++;
          if (request.mode === 'text') {
            for (const [index, line] of snapshot.text.split(/\r\n|\r|\n/).entries()) {
              if (result.hits.length >= 500) { warn('검색 결과 500개 한도에 도달했습니다.'); break; }
              if (!matches(line)) continue;
              const offset = (request.caseSensitive ? line : line.toLowerCase()).indexOf(query);
              result.hits.push({ kind: 'text', label: entry.name, relativePath: entry.relativePath, documentPath: entry.relativePath, line: index + 1, revision: snapshot.revision, context: line.slice(Math.max(0, offset - 60), offset + query.length + 120) });
            }
          } else {
            const analysis = await analyze(root, entry.relativePath, snapshot.text, false, false);
            if (analysis.diagnostics.length) warn(`${entry.relativePath}: 해석 진단이 있어 심볼 결과가 불완전할 수 있습니다.`);
            const candidates: SearchHit[] = [
              ...analysis.outline.map(a => ({ ...a, kind: 'section' as const, label: a.title, context: a.id, documentPath: entry.relativePath })),
              ...analysis.anchors.map(a => ({ ...a, kind: 'anchor' as const, label: a.id, context: a.title, documentPath: entry.relativePath })),
              ...analysis.attributes.filter(a => a.applied).map(a => ({ ...a, kind: 'attribute' as const, label: a.name, context: a.value, documentPath: entry.relativePath }))
            ];
            for (const hit of candidates) {
              // Search each file's own declarations; inherited include contexts belong to navigation.
              if (hit.relativePath !== entry.relativePath) continue;
              if (result.hits.length >= 500) { warn('검색 결과 500개 한도에 도달했습니다.'); break; }
              if (!matches(hit.label) && !matches(hit.context)) continue;
              result.hits.push({ ...hit, label: hit.label.slice(0, 240), context: hit.context.slice(0, 240), revision: snapshot.revision });
            }
          }
        } catch { warn(`${entry.relativePath}: 읽기 또는 해석 실패로 제외했습니다.`); }
      }
    } catch { warn(`${directory || '/'}: 폴더를 읽지 못했습니다.`); }
  }
  if (queue.length || limited()) warn('폴더·문서·시간 또는 결과 한도에 도달했습니다.');
  result.completedAt = new Date().toISOString();
  return result;
}

export { buildRelations } from './relations';

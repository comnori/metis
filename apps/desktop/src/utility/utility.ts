import { protocolVersion } from '@metis/contracts';
import { failure, type SemanticDiffRequest, type ContextRequest, type AnalyzeRequest, type SearchRequest, type ScopedRequest } from '@metis/contracts';
import { analyze, buildContext, semanticDiff } from '@metis/document-core';
import { search, buildRelations } from '@metis/knowledge-index';
process.parentPort?.postMessage({ type: 'ready', protocolVersion });
process.parentPort?.on('message', async ({ data }: { data: { type: string; root: string; request: AnalyzeRequest | SearchRequest | ScopedRequest } }) => {
  if (!['analyze', 'search', 'relations', 'context', 'semantic-diff'].includes(data.type)) return;
  let result;
  try { const request = data.request as AnalyzeRequest; result = { ok: true, requestId: request.requestId, value: data.type === 'semantic-diff' ? await semanticDiff(data.root, data.request as SemanticDiffRequest) : data.type === 'context' ? await buildContext(data.root, data.request as ContextRequest) : data.type === 'relations' ? await buildRelations(data.root) : data.type === 'search' ? await search(data.root, data.request as SearchRequest) : await analyze(data.root, request.relativePath, request.text) }; }
  catch (error) { result = failure(data.request.requestId, error); }
  process.parentPort?.postMessage({ type: 'analysis', requestId: data.request.requestId, result });
});

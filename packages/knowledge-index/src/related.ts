import type { WorkspaceRelation } from '@metis/contracts';
export interface RelatedReason { kind: 'outgoing' | 'incoming' | 'common'; edges: WorkspaceRelation[]; via?: string }
export interface RelatedDocument { path: string; reasons: RelatedReason[] }
export function relatedDocuments(edges: WorkspaceRelation[], selected: string, limit = 20): { documents: RelatedDocument[]; truncated: boolean } {
  const documents = new Map<string, RelatedDocument>(); let truncated = false;
  function add(path: string, reason: RelatedReason) {
    if (path === selected) return;
    let entry = documents.get(path);
    if (!entry) { if (documents.size >= limit) { truncated = true; return; } entry = { path, reasons: [] }; documents.set(path, entry); }
    if (entry.reasons.length >= 5) { truncated = true; return; }
    entry.reasons.push(reason);
  }
  const valid = edges.filter(edge => edge.state === 'resolved' && edge.targetPath && !edge.sourceUncertain);
  for (const edge of valid) {
    if (edge.relativePath === selected) add(edge.targetPath!, { kind: 'outgoing', edges: [edge] });
    else if (edge.targetPath === selected) add(edge.relativePath, { kind: 'incoming', edges: [edge] });
  }
  const targets = new Map<string, WorkspaceRelation>();
  for (const edge of valid) if (edge.kind === 'xref' && edge.relativePath === selected && edge.targetPath !== selected && !targets.has(edge.targetPath!)) targets.set(edge.targetPath!, edge);
  for (const edge of valid) {
    const own = targets.get(edge.targetPath!);
    if (own && edge.kind === 'xref' && edge.relativePath !== selected && edge.relativePath !== edge.targetPath) add(edge.relativePath, { kind: 'common', via: edge.targetPath, edges: [own, edge] });
  }
  return { documents: [...documents.values()].sort((a, b) => a.path.localeCompare(b.path)), truncated };
}

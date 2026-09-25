import type { ContextBundle, SourceLocation } from '@metis/contracts';

export interface Evidence extends SourceLocation {
  documentPath: string; revision: string; kind: 'block' | 'attribute' | 'relation';
  text: string; score: number; matched: string[]; sourceUncertain: boolean;
}
export interface EvidenceReport {
  hits: Evidence[]; terms: string[]; missingTerms: string[]; truncated: boolean;
  conflicts: Array<{ name: string; evidence: Evidence[] }>;
  warnings: string[];
}
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-US');

/** Pure, ephemeral retrieval over an explicitly reviewed snapshot. No disk or network access. */
export function findEvidence(bundle: ContextBundle, query: string): EvidenceReport {
  const terms = [...new Set(normalize(query.trim()).match(/[\p{L}\p{N}_-]+/gu) ?? [])].slice(0, 16);
  const report: EvidenceReport = { hits: [], terms, missingTerms: [], conflicts: [], truncated: false, warnings: [] };
  if (query.length > 300) { report.warnings.push('질의는 300자 이내로 입력하세요.'); return report; }
  if (!terms.length) { report.warnings.push('찾을 단어를 입력하세요.'); return report; }
  if ((normalize(query).match(/[\p{L}\p{N}_-]+/gu) ?? []).length > 16) report.warnings.push('질의의 앞 16개 고유 단어만 사용합니다.');
  const sources = new Map(bundle.sources.map(source => [source.relativePath, source]));
  const seen = new Set<string>(), found = new Set<string>();
  const attributes = new Map<string, Evidence[]>();
  function candidate(documentPath: string, source: SourceLocation, kind: Evidence['kind'], text: string, heading = '', uncertain = false): Evidence | undefined {
    const snapshot = sources.get(source.relativePath);
    if (!snapshot) return;
    const body = normalize(text), title = normalize(heading);
    const matched = terms.filter(term => body.includes(term) || title.includes(term));
    if (!matched.length) return;
    matched.forEach(term => found.add(term));
    const item: Evidence = { ...source, documentPath, revision: snapshot.revision, kind, text: text.slice(0, 2000), matched, score: matched.reduce((sum, term) => sum + (body.includes(term) ? 2 : 0) + (title.includes(term) ? 3 : 0), 0), sourceUncertain: uncertain };
    const key = JSON.stringify([documentPath, source.relativePath, source.line, kind, text]);
    if (!seen.has(key)) { seen.add(key); report.hits.push(item); }
    if (text.length > 2000) report.truncated = true;
    return item;
  }
  for (const doc of bundle.documents) {
    for (const block of doc.blocks) {
      // Use only interpreted blocks, never raw source fallback (inactive/tag-excluded content).
      candidate(doc.documentPath, block, 'block', [block.title, block.text].filter(Boolean).join('\n'), block.title, !!block.sourceUncertain);
    }
    for (const attr of doc.model.attributes.filter(item => item.applied)) {
      const hit = candidate(doc.documentPath, attr, 'attribute', `${attr.name}: ${attr.value}`, attr.name);
      if (hit) { const entries = attributes.get(attr.name) ?? []; entries.push(hit); attributes.set(attr.name, entries); }
    }
    for (const relation of doc.model.relations) {
      candidate(doc.documentPath, relation, 'relation', `${relation.kind} ${relation.target} · ${relation.state}`, relation.target, !!relation.sourceUncertain);
    }
  }
  for (const [name, evidence] of attributes) {
    if (new Set(evidence.map(item => item.text)).size > 1) report.conflicts.push({ name, evidence: evidence.slice(0, 8) });
  }
  report.hits.sort((a, b) => b.score - a.score || a.documentPath.localeCompare(b.documentPath) || a.relativePath.localeCompare(b.relativePath) || a.line - b.line);
  report.truncated ||= report.hits.length > 40;
  report.hits = report.hits.slice(0, 40);
  report.missingTerms = terms.filter(term => !found.has(term));
  if (bundle.validation.partial) report.warnings.push('해석·검증이 불완전합니다. 차단된 포함이나 미확인 참조의 내용을 답변 근거로 사용하지 않았습니다.');
  if (report.conflicts.length) report.warnings.push('동일 속성의 값 차이를 발견했습니다. 시점·상위 문서에 따른 차이일 수 있으며 논리적 모순으로 확정하지 않습니다.');
  return report;
}

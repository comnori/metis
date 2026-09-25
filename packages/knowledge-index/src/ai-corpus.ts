import type { AiEvidence, ContextBundle } from '@metis/contracts';
export function aiCorpus(bundle: ContextBundle): { evidence: AiEvidence[]; truncated: boolean; error?: string } {
  const evidence: AiEvidence[] = []; let truncated = false;
  const add = (documentPath: string, item: { relativePath: string; line: number; sourceUncertain?: boolean }, text: string, kind: string) => {
    const snapshot = bundle.sources.find(source => source.relativePath === item.relativePath);
    if (!snapshot || !text.trim()) return;
    truncated ||= text.length > 2000;
    evidence.push({ id: `E${evidence.length + 1}`, documentPath, relativePath: item.relativePath, line: item.line, revision: snapshot.revision, text: text.slice(0, 2000), kind, sourceUncertain: !!item.sourceUncertain });
  };
  for (const doc of bundle.documents) {
    for (const block of doc.blocks) add(doc.documentPath, block, [block.title, block.text].filter(Boolean).join('\n'), block.kind);
    for (const attr of doc.model.attributes.filter(item => item.applied)) add(doc.documentPath, attr, `${attr.name}: ${attr.value}`, 'attribute');
    for (const rel of doc.model.relations) add(doc.documentPath, rel, `${rel.kind} ${rel.target} · ${rel.state}`, 'explicit-relation');
  }
  const error = evidence.length > 128 || JSON.stringify(evidence).length > 100000 ? 'AI 발췌 한도(128개·100,000자)를 초과했습니다. 문서 범위를 줄여 주세요.' : !evidence.length ? '전송할 해석 근거가 없습니다.' : undefined;
  return { evidence, truncated, error };
}

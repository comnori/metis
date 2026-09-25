export interface ProposedChange { id: string; before: string; after: string; reason: string; start: number; end: number; evidence?: Array<{ quote: string; line: number }> }
export function parseProposal(input: string, baseline: string): ProposedChange[] {
  if (input.length > 1024 * 1024 || baseline.length > 1024 * 1024) throw new Error('제안과 기준 원문은 각각 1 MiB 문자 한도 이내여야 합니다.');
  const value = JSON.parse(input);
  if (!value || Object.keys(value).sort().join(',') !== 'changes,version' || value.version !== 1 || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 20) throw new Error('version: 1과 변경 1~20개가 필요합니다.');
  const ids = new Set<string>();
  const changes: ProposedChange[] = value.changes.map((item: unknown) => {
    const c = item as ProposedChange;
    if (!c || !['after,before,id,reason', 'after,before,evidence,id,reason'].includes(Object.keys(c).sort().join(',')) || typeof c.id !== 'string' || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id) || [c.before, c.after, c.reason].some(s => typeof s !== 'string' || !s.isWellFormed() || /[\0\r]/.test(s)) || !c.before || !c.reason.trim() || c.reason.length > 2000 || c.before === c.after) throw new Error('변경 ID·이전/이후 원문·이유를 확인하세요. 줄바꿈은 LF를 사용하세요.');
    ids.add(c.id);
    const start = baseline.indexOf(c.before);
    if (start < 0 || baseline.indexOf(c.before, start + 1) >= 0) throw new Error(`변경 ${c.id}: 이전 원문이 정확히 한 곳에 있어야 합니다.`);
    let evidence: ProposedChange['evidence'];
    if ('evidence' in c) {
      if (!Array.isArray(c.evidence) || !c.evidence.length || c.evidence.length > 8) throw new Error('근거 인용은 1~8개가 필요합니다.');
      const seen = new Set<string>();
      evidence = c.evidence.map(item => {
        if (!item || Object.keys(item).join(',') !== 'quote' || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 2000 || !item.quote.isWellFormed() || /[\0\r]/.test(item.quote) || seen.has(item.quote)) throw new Error('근거 인용 형식이 올바르지 않습니다.');
        seen.add(item.quote); const offset = baseline.indexOf(item.quote);
        if (offset < 0 || baseline.indexOf(item.quote, offset + 1) >= 0) throw new Error('근거 인용이 기준 원문에서 정확히 한 곳과 일치해야 합니다.');
        return { quote: item.quote, line: baseline.slice(0, offset).split('\n').length };
      });
    }
    return { id: c.id, before: c.before, after: c.after, reason: c.reason, start, end: start + c.before.length, ...(evidence ? { evidence } : {}) };
  });
  changes.sort((a, b) => a.start - b.start);
  if (changes.some((c, i) => i > 0 && changes[i - 1].end > c.start)) throw new Error('변경 범위가 겹칩니다. 제안을 다시 구성하세요.');
  return changes;
}
export function selectProposal(baseline: string, changes: ProposedChange[], ids: string[]): string {
  if (new Set(ids).size !== ids.length || ids.some(id => !changes.some(c => c.id === id))) throw new Error('선택한 변경을 확인하세요.');
  let result = baseline;
  for (const c of [...changes].sort((a, b) => b.start - a.start)) if (ids.includes(c.id)) {
    if (baseline.slice(c.start, c.end) !== c.before) throw new Error('제안 기준 원문이 바뀌었습니다.');
    result = result.slice(0, c.start) + c.after + result.slice(c.end);
  }
  if (result.length > 1024 * 1024) throw new Error('선택한 변경의 결과가 1 MiB 문자 한도를 초과합니다.');
  return result;
}

import { analyze } from './index';
import { validateContext } from './validation';
import { validate, type SemanticDiffRequest, type SemanticDiffResult, type SemanticUnit, type SemanticBlock } from '@metis/contracts';
export async function semanticDiff(root: string, request: SemanticDiffRequest): Promise<SemanticDiffResult> {
  validate('semanticDiff', request);
  const result: SemanticDiffResult = { changes: [], partial: false, truncated: false, validation: {}, warnings: [
    '두 원문만 비교합니다. 포함 파일 본문과 참조 대상은 읽지 않습니다. 포함된 내용의 의미 변화는 확인하지 못합니다.',
    '절 ID와 같은 종류의 등장 순서로 대응합니다. 이름 변경·이동은 추가/삭제 또는 여러 변경으로 보일 수 있습니다.',
    '블록은 해석된 종류와 치환 전 원문을 비교합니다. 인라인·표 셀·목록 항목의 완전한 의미 비교가 아닙니다. 텍스트 차이도 확인하세요.'
  ] };
  async function units(text: string, side: string): Promise<SemanticUnit[] | undefined> {
    try {
      const blocks: SemanticBlock[] = [];
      const model = await analyze(root, request.relativePath, text, false, true, { sources: new Map(), blocks, includeBlockedMessage: '이 비교에서는 포함 선언만 사용하며 포함 파일 본문은 해석하지 않습니다.' });
      result.validation![side === '이전' ? 'before' : 'after'] = validateContext({ sources: [{ relativePath: request.relativePath, text, revision: '', byteLength: Buffer.byteLength(text) }], documents: [{ documentPath: request.relativePath, blocks, model }] });
      if (model.diagnostics.length || model.relations.some(r => r.kind === 'include' || r.sourceUncertain) || model.conditions.some(c => c.state === 'unknown')) result.partial = true;
      for (const diagnostic of model.diagnostics) if (result.warnings.length < 103) result.warnings.push(`${side} ${diagnostic.relativePath}:${diagnostic.line}: ${diagnostic.message}`);
      const out: SemanticUnit[] = [], counts = new Map<string, number>();
      const add = (category: SemanticUnit['category'], key: string, value: unknown, location: { relativePath: string; line: number }) => {
        const base = `${category}:${key}`, ordinal = counts.get(base) ?? 0; counts.set(base, ordinal + 1);
        out.push({ category, key: `${base}:${ordinal}`, value: typeof value === 'string' ? value : JSON.stringify(value), relativePath: location.relativePath, line: location.line });
      };
      add('section', 'document-title', model.title ?? '', { relativePath: request.relativePath, line: 1 });
      for (const s of model.outline) add('section', s.id || s.title, { title: s.title, level: s.level }, s);
      for (const b of blocks) if (b.kind !== 'section' && (b.text || b.title)) add('block', b.kind, { kind: b.kind, title: b.title, text: b.text }, b);
      for (const a of model.attributes) add('attribute', a.name, { name: a.name, value: a.value, applied: a.applied }, a);
      for (const r of model.relations) { if (r.sourceUncertain) continue; add(r.kind === 'include' ? 'include' : 'reference', r.target, r.kind === 'include' ? { target: r.target, declaration: text.split(/\r\n|\r|\n/)[r.line - 1] ?? r.target } : r.target, r); }
      for (const c of model.conditions) add('condition', c.expression, { expression: c.expression, state: c.state }, c);
      return out;
    } catch (error) { result.partial = true; result.warnings.push(`${side} 해석 실패: ${error instanceof Error ? error.message : '해석할 수 없습니다.'} 텍스트 차이를 확인하세요.`); return undefined; }
  }
  const before = await units(request.before, '이전'), after = await units(request.after, '이후');
  // A failed side must not turn every unit of the other side into an addition/removal.
  if (!before || !after) return result;
  const a = new Map(before.map(u => [u.key, u])), b = new Map(after.map(u => [u.key, u]));
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(key), right = b.get(key);
    if (left?.value === right?.value) continue;
    if (result.changes.length >= 1000) { result.partial = true; result.truncated = true; break; }
    result.changes.push({ kind: left && right ? 'modified' : left ? 'removed' : 'added', before: left, after: right });
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) { result.changes = []; result.validation = undefined; result.partial = true; result.truncated = true; result.warnings.push('의미 비교 결과가 8 MiB를 초과했습니다. 텍스트 차이를 확인하세요.'); }
  return result;
}

import path from 'node:path';
import type { ContextBundle, ContextDocument, ValidationIssue, ValidationReport, SourceLocation } from '@metis/contracts';

// Pure projection over the reviewed snapshot: no reads, writes, or AI calls.
export function validateContext(bundle: Pick<ContextBundle, 'sources' | 'documents'>): ValidationReport {
  const report: ValidationReport = { issues: [], checkedDocuments: bundle.documents.length, checkedReferences: 0, partial: false, truncated: false };
  const selected = new Set(bundle.sources.map(item => item.relativePath));
  const documents = new Map(bundle.documents.map(item => [item.documentPath, item]));
  const seen = new Set<string>();
  function add(documentPath: string, source: SourceLocation, category: ValidationIssue['category'], certainty: ValidationIssue['certainty'], code: string, message: string, sourceUncertain = false) {
    if (certainty !== 'confirmed') report.partial = true;
    const key = JSON.stringify([documentPath, source.relativePath, source.line, code, message]);
    if (seen.has(key)) return; seen.add(key);
    if (report.issues.length >= 1000) { report.partial = true; report.truncated = true; return; }
    report.issues.push({ id: `issue-${report.issues.length + 1}`, documentPath, relativePath: source.relativePath, line: sourceUncertain ? 1 : source.line, category, certainty, code, message, sourceUncertain });
  }
  // Missing-anchor claims need an intact target model, including its includes.
  const complete = (doc: ContextDocument) => !doc.model.diagnostics.length && !doc.model.conditions.some(item => item.state === 'unknown') && !doc.model.relations.some(item => item.kind === 'include' && item.state !== 'resolved') && [doc.model.outline, doc.model.anchors, doc.model.relations, doc.model.attributes, doc.model.attributeUses, doc.model.conditions].every(items => items.length < 2000);
  for (const doc of bundle.documents) {
    const root = doc.documentPath;
    const undefinedUses = doc.model.attributeUses.filter(item => item.value === undefined);
    for (const item of undefinedUses) add(root, item, 'attribute', 'confirmed', 'undefined-attribute', `이 해석 맥락에서 속성 {${item.name}}의 값이 정의되지 않았습니다.`);
    for (const diagnostic of doc.model.diagnostics) {
      // The same undefined use is already represented by a typed rule above.
      if (undefinedUses.some(item => item.relativePath === diagnostic.relativePath && item.line === diagnostic.line && diagnostic.message === `정의되지 않은 속성: ${item.name}`)) continue;
      add(root, diagnostic, 'structure', 'parser', 'parser-diagnostic', diagnostic.message);
    }
    for (const item of doc.model.conditions.filter(item => item.state === 'unknown')) add(root, item, 'coverage', 'unchecked', 'unknown-condition', `조건의 적용 여부를 확인하지 못했습니다: ${item.expression}. ${item.reason}`);
    for (const relation of doc.model.relations) {
      if (relation.kind === 'include') {
        if (relation.state !== 'resolved') add(root, relation, 'include', 'unchecked', 'include-unchecked', `포함 내용을 검증하지 못했습니다: ${relation.target}. ${relation.message ?? '포함 해석이 완료되지 않았습니다.'}`);
        continue;
      }
      const unknown = (code: string, message: string) => add(root, relation, 'reference', 'unchecked', code, message, relation.sourceUncertain);
      if (relation.sourceUncertain) { unknown('uncertain-source', '참조 선언의 정확한 출처가 불명확합니다. 파일 처음에서 원문을 확인하세요.'); continue; }
      const target = relation.target;
      if (!target || /[\\:\x00-\x1f%{}]/.test(target) || target.startsWith('/')) { unknown('unsupported-target', `지원 범위 밖의 참조 형식입니다: ${target}`); continue; }
      const hash = target.indexOf('#');
      const file = hash >= 0 ? target.slice(0, hash) : /\.adoc$/i.test(target) ? target : '';
      const anchor = hash >= 0 ? target.slice(hash + 1) : file ? '' : target;
      const targetPath = file ? path.posix.normalize(path.posix.join(path.posix.dirname(relation.relativePath), file)) : root;
      if (targetPath === '..' || targetPath.startsWith('../') || !selected.has(targetPath)) { unknown('outside-selection', `선택 범위 밖이라 대상 존재 여부를 확인하지 않았습니다: ${targetPath}`); continue; }
      if (!anchor) { report.checkedReferences++; continue; }
      const targetDoc = documents.get(targetPath);
      if (!targetDoc) { unknown('target-not-analyzed', `앵커를 검증하려면 ${targetPath}을 해석 기준으로 추가하세요.`); continue; }
      if (targetDoc.model.anchors.some(item => item.id === anchor)) { report.checkedReferences++; continue; }
      if (!complete(targetDoc)) { unknown('incomplete-target', `${targetPath}의 해석이 불완전해 앵커 #${anchor}의 부재를 확정하지 않습니다.`); continue; }
      report.checkedReferences++;
      add(root, relation, 'reference', 'confirmed', 'missing-anchor', `선택한 해석 맥락 ${targetPath}에서 앵커를 찾지 못했습니다: #${anchor}`);
    }
    if (!complete(doc)) report.partial = true;
  }
  return report;
}

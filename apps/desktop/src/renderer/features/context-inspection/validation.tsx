import React, { useState } from 'react';
import type { ValidationIssue, ValidationReport, SourceLocation } from '@metis/contracts';
const categories = { structure: '구조·해석', reference: '참조', include: '포함', attribute: '속성', coverage: '검증 범위' };
const certainties = { confirmed: '규칙으로 확인', parser: '해석기 진단', unchecked: '미확인' };
export function ValidationResults({ report, documents, source }: { report: ValidationReport; documents: string[]; source(item: SourceLocation): React.ReactNode }) {
  const [category, setCategory] = useState('all'), [certainty, setCertainty] = useState('all'), [documentPath, setDocumentPath] = useState('all');
  const items = report.issues.filter(item => (category === 'all' || item.category === category) && (certainty === 'all' || item.certainty === certainty) && (documentPath === 'all' || item.documentPath === documentPath));
  const count = (kind: ValidationIssue['certainty']) => report.issues.filter(item => item.certainty === kind).length;
  return <section aria-label="문서 검증 결과"><h3>검증 결과</h3>
    <p>해석 기준 {report.checkedDocuments}개 · 확인한 참조 {report.checkedReferences}개 · 규칙으로 확인 {count('confirmed')}개 · 해석기 진단 {count('parser')}개 · 미확인 {count('unchecked')}개</p>
    <p>로컬 규칙과 해석기 결과입니다. AI 추론 의견은 생성하지 않았습니다.</p>
    {report.partial && <p className="notice">일부 범위를 확인하지 못했거나 해석 진단이 있습니다. 미확인 항목을 정상으로 판정하지 않습니다.</p>}
    {report.truncated && <p role="alert">결과 1,000개 한도에 도달했습니다. 표시된 개수는 전체 문제 수가 아닙니다. 범위를 줄여 다시 검증하세요.</p>}
    <div className="tools">
      <label>분류<select aria-label="검증 분류" value={category} onChange={event => setCategory(event.target.value)}><option value="all">전체</option>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label>판정<select aria-label="검증 판정" value={certainty} onChange={event => setCertainty(event.target.value)}><option value="all">전체</option>{Object.entries(certainties).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label>해석 기준<select aria-label="검증 해석 기준" value={documentPath} onChange={event => setDocumentPath(event.target.value)}><option value="all">전체</option>{documents.map(path => <option key={path}>{path}</option>)}</select></label>
    </div>
    {!items.length && <p>{report.issues.length ? '선택한 필터에 해당하는 항목이 없습니다.' : report.partial ? '표시할 항목은 없지만 전체 범위를 확인한 결과는 아닙니다.' : '선택한 해석 범위의 규칙 검사에서 보고할 항목이 없습니다. 문서 내용 전체의 정확성을 보증하지 않습니다.'}</p>}
    {items.map(item => <article key={item.id} className="validation-issue"><h4>{categories[item.category]} · {certainties[item.certainty]}</h4><p>{item.message}</p><p>해석 기준: {item.documentPath}</p>{item.sourceUncertain && <p>정확한 행 미확인 · 파일 처음으로 이동합니다.</p>}{source(item)}</article>)}
  </section>;
}

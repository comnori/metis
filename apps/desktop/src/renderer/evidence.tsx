import React, { useState } from 'react';
import type { ContextBundle, SourceLocation } from '@metis/contracts';
import { findEvidence, type EvidenceReport } from '@metis/knowledge-index/evidence';

export function EvidenceSearch({ bundle, source }: { bundle: ContextBundle; source(where: SourceLocation): React.ReactNode }) {
  const [query, setQuery] = useState(''), [report, setReport] = useState<EvidenceReport>();
  return <section aria-label="문서 근거 검색"><h3>문서 질의 · 로컬 근거 탐색</h3>
    <p>단어를 입력하면 해석된 절·블록·속성·참조에서 관련 근거를 추천합니다. 이 검색은 단어 일치와 제목 가중치를 사용합니다. AI 의미 검색은 아래에서 별도로 실행합니다. 추천 순위는 사실의 확실성을 뜻하지 않습니다.</p>
    <form onSubmit={event => { event.preventDefault(); setReport(findEvidence(bundle, query)); }}><label>찾을 내용<input maxLength={300} value={query} onChange={event => { setQuery(event.target.value); setReport(undefined); }} /></label><button disabled={!query.trim()}>근거 찾기</button></form>
    {report && <section aria-label="근거 검색 결과"><p role="status">{report.hits.length ? `추천 근거 ${report.hits.length}개 · 자동 답변 없음` : '근거 부족: 선택한 해석 범위에서 일치하는 근거를 찾지 못했습니다.'}</p>
      <p>검색 단어: {report.terms.join(', ')} · 최대 40개 결과, 발췌당 2,000자</p>
      {report.missingTerms.length > 0 && <p>근거 부족 · 일치하지 않은 단어: {report.missingTerms.join(', ')}</p>}
      {report.truncated && <p>일부 결과 또는 발췌가 잘렸습니다. 원문을 확인하거나 질의를 좁혀 주세요.</p>}
      {report.warnings.map(warning => <p key={warning}>{warning}</p>)}
      {report.conflicts.map(conflict => <details key={conflict.name}><summary>상충 후보: {conflict.name} 값 차이</summary>{conflict.evidence.map((item, i) => <p key={i}>{item.documentPath} · {item.text} · {source(item)}</p>)}<p>속성별 근거는 최대 8개 표시합니다. 일반 문장의 모순은 판정하지 않습니다.</p></details>)}
      {report.hits.map((item, i) => <article key={i}><h4>{item.kind === 'relation' ? '명시적 관계 선언' : '검색 추천 근거'}</h4><p>해석 기준: {item.documentPath} · 일치 단어: {item.matched.join(', ')}</p><pre>{item.text}</pre>{item.sourceUncertain ? <p>출처 위치 미확인 · {source({ relativePath: item.relativePath, line: 1 })}</p> : source(item)}<p>저장본 리비전: {item.revision}</p></article>)}
    </section>}
  </section>;
}

import React from 'react';
import type { ValidationReport } from '@metis/contracts';
export function ProposalValidation({ before, after }: { before: ValidationReport; after: ValidationReport }) {
  return <section aria-label="제안 문서 검증"><h3>선택 결과의 문서 검증</h3>
    <p>현재 문서의 변경 전후 원문을 문서 검증 규칙으로 검사했습니다. 포함 파일·외부 참조 대상은 읽지 않습니다. 항목 수 감소가 정확성 향상을 뜻하지 않으며, 행 이동 때문에 동일 문제도 다른 위치에 표시될 수 있습니다.</p>
    <table className="proposal-validation-table"><thead><tr><th>항목</th><th>변경 전</th><th>선택 결과</th></tr></thead><tbody>
      <tr><th>검증 항목</th><td>{before.issues.length}</td><td>{after.issues.length}</td></tr>
      <tr><th>확인한 참조</th><td>{before.checkedReferences}</td><td>{after.checkedReferences}</td></tr>
      <tr><th>검사 범위</th><td>{before.partial ? '부분 검증' : '지원 규칙 검사 완료'}{before.truncated && ' · 일부 생략'}</td><td>{after.partial ? '부분 검증' : '지원 규칙 검사 완료'}{after.truncated && ' · 일부 생략'}</td></tr>
    </tbody></table>
    {([['변경 전', before], ['선택 결과', after]] as const).map(([label, report]) => <details key={label} open={report.issues.length > 0}><summary>{label} 검증 상세 ({report.issues.length})</summary>
      {!report.issues.length && <p>검출된 항목 없음. 문서의 사실성·완전성을 보증하지 않습니다.</p>}
      {report.issues.map(issue => <p key={issue.id}>{issue.relativePath}:{issue.line} · {issue.certainty === 'confirmed' ? '규칙으로 확인' : issue.certainty === 'parser' ? '파서 진단' : '미검증'} · {issue.message}{issue.sourceUncertain && ' (위치 불확실)'}</p>)}
    </details>)}
  </section>;
}

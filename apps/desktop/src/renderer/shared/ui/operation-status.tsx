import React from 'react';
import './operation-status.css';
export type OperationPhase = 'idle' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled';
const labels: Record<OperationPhase, string> = { idle: '대기', running: '진행 중', complete: '완료', partial: '일부 완료', failed: '실패', cancelled: '취소됨' };
export function OperationStatus({ task, phase, message, next, progressLabel }: { task: string; phase: OperationPhase; message: string; next?: string; progressLabel?: string }) {
  return <div className="operation-status" data-phase={phase}>
    <p role={phase === 'failed' ? 'alert' : 'status'}>{phase === 'running' && <progress aria-label={progressLabel ?? `${task} 진행`} />}<strong>{task} · {labels[phase]}</strong> — {message}</p>
    {next && <p>다음 행동: {next}</p>}
  </div>;
}
export function ChangeScope({ target, basis, effect, recovery }: { target: string; basis: string; effect: string; recovery: string }) {
  return <section className="change-scope" aria-label="변경 범위와 복구"><h3>변경 범위와 복구</h3><dl>
    <dt>대상</dt><dd>{target}</dd><dt>비교 기준</dt><dd>{basis}</dd><dt>반영 결과</dt><dd>{effect}</dd><dt>복구</dt><dd>{recovery}</dd>
  </dl></section>;
}

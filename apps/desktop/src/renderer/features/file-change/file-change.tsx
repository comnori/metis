import { openDialog } from '../../shared/lib/accessibility';
import React, { useEffect, useRef, useState } from 'react';
import { validDocumentPath, type Session, type FileChangePlan, type FileChangeResult, type OperationStatus } from '@metis/contracts';
import '../../shared/styles/dialog.css';
export function FileChange({ session, path, dirty, close, applied }: { session: Session; path: string; dirty(path: string): boolean; close(): void; applied(plan: FileChangePlan, result: FileChangeResult): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef<{ id: string; review: boolean; cancelled: boolean } | undefined>(undefined);
  const [progress, setProgress] = useState<OperationStatus>();
  const [action, setAction] = useState<'move' | 'delete'>('move'), [destination, setDestination] = useState(path), [plan, setPlan] = useState<FileChangePlan>(), [result, setResult] = useState<FileChangeResult>(), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); return () => restoreFocus(); }, []);
  useEffect(() => {
    if (!busy) return;
    let alive = true;
    const timer = setInterval(() => {
      const current = operation.current;
      if (current) void window.metis.fileOperationStatus({ ...scope(), operationId: current.id }).then(response => { if (alive && operation.current === current && response.ok) setProgress(response.value); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearInterval(timer); };
  }, [busy]);
  useEffect(() => () => {
    const current = operation.current;
    if (current?.review) { current.cancelled = true; void window.metis.cancelFileReview({ ...scope(), operationId: current.id }).catch(() => {}); }
  }, []);
  async function cancelReview() {
    const current = operation.current;
    if (!current?.review) return;
    current.cancelled = true; setPlan(undefined);
    try { const response = await window.metis.cancelFileReview({ ...scope(), operationId: current.id }); setError(response.ok ? '영향 검토를 중단했습니다. 원본은 변경하지 않았습니다.' : response.error.message); }
    catch { setError('취소 응답을 확인하지 못했습니다. 검토 결과는 적용하지 않습니다.'); }
  }
  async function preview() {
    setBusy(true); setError(''); setPlan(undefined); setResult(undefined); setSelected([]);
    const request = scope(), current = { id: request.requestId, review: true, cancelled: false }; operation.current = current; setProgress(undefined);
    try { const response = await window.metis.previewFileChange({ ...request, relativePath: path, action, destination: action === 'delete' ? '' : destination }); if (!current.cancelled) { if (response.ok) setPlan(response.value); else setError(response.error.message); } }
    catch { setError('영향 검토 응답을 받지 못했습니다. 다시 검토해 주세요.'); } finally { setBusy(false); }
  }
  async function apply() {
    if (!plan) return;
    if (dirty(path) || (plan.destination && dirty(plan.destination)) || plan.impacts.some(hit => selected.includes(hit.id) && dirty(hit.relativePath))) { setError('대상 또는 선택한 참조 문서에 미저장 편집이 있습니다. 저장하거나 별도로 보존한 뒤 다시 검토해 주세요.'); return; }
    setBusy(true); setError('');
    const request = scope(); operation.current = { id: request.requestId, review: false, cancelled: false }; setProgress(undefined);
    try { const response = await window.metis.applyFileChange({ ...request, planId: plan.id, selected }); if (response.ok) { setResult(response.value); applied(plan, response.value); } else { setError(response.error.message); setPlan(undefined); } }
    catch { setError('실행 응답을 확인하지 못했습니다. 원본·대상·복구 사본을 확인하고 다시 검토해 주세요.'); setPlan(undefined); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="recovery-dialog" aria-label="파일 변경 검토" onCancel={event => { event.preventDefault(); if (!busy) close(); else if (operation.current?.review) void cancelReview(); }}>
    <h2>파일 변경 · {path}</h2><p>저장된 원문 기준입니다. 이동·삭제 전 복구 사본을 보존합니다. 새 경로의 부모 폴더는 먼저 만들어 주세요.</p>
    <fieldset disabled={busy || !!result}><label>작업<select aria-label="작업" value={action} onChange={event => { setAction(event.target.value as 'move' | 'delete'); setPlan(undefined); }}><option value="move">이동 · 이름 변경</option><option value="delete">삭제 · 원본 보존</option></select></label>
      {action === 'move' && <label>새 상대 경로<input value={destination} onChange={event => { setDestination(event.target.value); setPlan(undefined); }} /></label>}
      <button disabled={action === 'move' && !validDocumentPath(destination)} onClick={preview}>영향 검토</button></fieldset>
    {busy && <div role="status"><progress aria-label="파일 작업 진행" value={progress?.total ? progress.completed : undefined} max={progress?.total} /><p>{operation.current?.review ? `영향 검토 중 · ${progress?.completed ?? 0}개 문서 확인` : '파일 적용 중 · 완료 후 항목별 결과를 확인하세요.'}</p>{operation.current?.review && <button onClick={cancelReview}>검토 중단</button>}</div>}{error && <p role="alert">{error}</p>}
    {plan && !result && <><p>{plan.scanned}개 문서 확인 · {plan.impacts.length}개 후보</p>{plan.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      {!plan.impacts.length && <p>정적 후보를 찾지 못했습니다. 영향이 없다는 뜻은 아닙니다.</p>}
      {plan.impacts.map(hit => <article key={hit.id}><label><input type="checkbox" disabled={busy || !hit.after || dirty(hit.relativePath)} checked={selected.includes(hit.id)} onChange={event => setSelected(values => event.target.checked ? [...values, hit.id] : values.filter(id => id !== hit.id))} />{hit.relativePath}:{hit.line}{dirty(hit.relativePath) ? ' · 미저장 편집으로 선택 불가' : ''}</label><pre style={{ whiteSpace: 'pre-wrap' }}>현재: {hit.before}{hit.after ? `\n변경: ${hit.after}` : '\n자동 변경하지 않는 영향 후보'}</pre></article>)}
      <p>선택하지 않은 경로는 유지되며 깨진 참조가 남을 수 있습니다. 삭제 시 참조 원문은 바꾸지 않습니다.</p><button disabled={busy || dirty(path)} onClick={apply}>{action === 'delete' ? '검토한 파일 삭제' : '파일 이동과 선택 항목 적용'}</button>{dirty(path) && <p>원본 탭의 미저장 편집을 먼저 처리해 주세요.</p>}</>}
    {result && <section aria-label="파일 변경 결과"><h3>{result.items.some(item => item.state === 'failed') ? '실패 또는 부분 완료 · 항목별 확인 필요' : '실행 완료 · 미선택 항목 확인'}</h3>{result.items.map((item, i) => <p key={i}>{item.relativePath} · {{ done: '완료', failed: '실패', skipped: '미적용' }[item.state]} · {item.message}</p>)}<p>열린 문서는 다시 확인합니다. 검색·다른 문서의 미리보기는 새로 고침해 주세요.</p></section>}
    <div className="tools"><button disabled={busy} onClick={close}>{result ? '닫기' : '취소'}</button></div>
  </dialog>;
}

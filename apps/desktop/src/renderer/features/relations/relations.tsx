import { openDialog } from '../../shared/lib/accessibility';
import React, { useEffect, useRef, useState } from 'react';
import type { Session, RelationIndex, WorkspaceRelation, SourceLocation } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import { RelatedView } from './related';
import { OperationStatus, type OperationPhase } from '../../shared/ui/operation-status';
export function Relations({ session, initialPath, initialMode = 'list', close, open, embedded = false }: { session: Session; initialPath?: string; initialMode?: 'list' | 'graph'; close(): void; open(source: SourceLocation, revision?: string): void; embedded?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), panel = useRef<HTMLElement>(null), active = useRef(true), pending = useRef(false), token = useRef(0), paused = useRef(false);
  const [index, setIndex] = useState<RelationIndex>(), [selected, setSelected] = useState(initialPath ?? ''), [busy, setBusy] = useState(false), [status, setStatus] = useState('관계 조사 준비 중');
  const [phase, setPhase] = useState<OperationPhase>('idle');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { if (initialPath) setSelected(initialPath); }, [initialPath]);
  async function rebuild() {
    if (pending.current) return;
    pending.current = true; const generation = ++token.current;
    setPhase('running'); setBusy(true); setStatus('저장본 관계 갱신 중 · 기존 결과는 이전 조사 기준입니다.');
    try {
      const response = await window.metis.workspaceRelations(scope());
      if (!active.current || generation !== token.current) return;
      if (response.ok) { setPhase(response.value.partial ? 'partial' : 'complete'); setIndex(response.value); setSelected(value => value || response.value.documents[0] || ''); setStatus(response.value.partial ? '일부 범위의 관계입니다. 경고를 확인하세요.' : '관계 조사를 완료했습니다.'); }
      else { setPhase(response.error.code === 'CANCELLED' ? 'cancelled' : 'failed'); setStatus(response.error.message); }
    } catch { if (active.current && generation === token.current) { setPhase('failed'); setStatus('관계 조사 응답을 받지 못했습니다. 다시 조사해 주세요.'); } }
    finally { if (active.current && generation === token.current) { pending.current = false; setBusy(false); } }
  }
  function cancel() {
    paused.current = true; token.current++; pending.current = false; setPhase('cancelled'); setBusy(false); setStatus('관계 조사를 취소했습니다. 기존 결과는 이전 조사 기준입니다. 다시 조사하면 자동 갱신을 재개합니다.');
    void window.metis.cancelRelations(scope()).catch(() => {});
  }
  useEffect(() => {
    active.current = true; const restoreFocus = embedded ? () => {} : openDialog(dialog.current!); void rebuild();
    const timer = setInterval(() => { if (!paused.current) void rebuild(); }, 5000);
    return () => { active.current = false; token.current++; clearInterval(timer); restoreFocus(); void window.metis.cancelRelations(scope()).catch(() => {}); };
  }, []);
  const edges = index?.edges ?? [];
  const backlinks = edges.filter(edge => edge.kind === 'xref' && edge.targetPath === selected && edge.relativePath !== selected);
  const outgoing = edges.filter(edge => edge.relativePath === selected);
  const parents = [...new Set(edges.filter(edge => edge.kind === 'include' && edge.targetPath === selected).map(edge => edge.documentPath))].filter(value => value !== selected);
  const choices = [...new Set([selected, ...(index?.documents ?? []), ...edges.flatMap(edge => edge.targetPath ? [edge.targetPath] : [])])].filter(Boolean).sort();
  function rows(items: WorkspaceRelation[]) { return items.length ? items.map((edge, i) => <article key={i}>
    <p>{edge.kind === 'xref' ? '참조' : '포함'} · {edge.target} · {{ resolved: '연결됨', missing: '대상 없음', blocked: '차단됨', unchecked: '미확인' }[edge.state]}</p>
    <button onClick={() => { open({ relativePath: edge.relativePath, line: edge.revision ? edge.line : 1 }, edge.revision); close(); }}>출처: {edge.relativePath}:{edge.line}</button>
    <small> · 해석 문서: {edge.documentPath}</small>{edge.message && <p>{edge.message}</p>}
  </article>) : <p>확인된 관계가 없습니다.{index?.partial ? ' 전체 범위를 확인한 결과는 아닙니다.' : ''}</p>; }
  const content = <>
    <div className="graph-view-heading"><div><span>KNOWLEDGE GRAPH</span><h2>그래프 뷰</h2></div><button onClick={close}>닫기</button></div><p>저장본 기준 · 미저장 편집 제외 · 창이 열린 동안 5초 간격으로 재조사합니다.</p>
    <div className="tools"><button disabled={busy} onClick={() => { paused.current = false; void rebuild(); }}>관계 다시 조사</button>{busy && <button onClick={cancel}>관계 조사 취소</button>}</div>
    <OperationStatus task="관계 조사" phase={phase} message={status} next={phase === 'failed' || phase === 'cancelled' ? '기존 결과는 이전 조사 기준입니다. 관계 다시 조사로 갱신하세요.' : phase === 'partial' ? '조사 범위와 경고를 확인하세요.' : undefined} />
    <label>대상 문서<select aria-label="대상 문서" value={selected} onChange={event => setSelected(event.target.value)}>{choices.map(value => <option key={value}>{value}</option>)}</select></label>
    <RelatedView key={selected} index={index} selected={selected} initialMode={initialMode} open={(source, revision) => { open(source, revision); close(); }} />
    {index && <><p>{index.scanned}개 문서 해석 · {edges.length}개 관계 · {new Date(index.completedAt).toLocaleTimeString()} 기준</p>
      {index.warnings.length > 0 && <details><summary>조사 범위와 경고</summary>{index.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      <section aria-label="백링크"><h3>백링크</h3>{rows(backlinks)}</section>
      <section aria-label="참조와 포함"><h3>이 파일에서 선언한 참조·포함</h3>{rows(outgoing)}</section>
      <section aria-label="포함 변경 영향"><h3>포함 변경 영향 · 상위 문서</h3>{parents.length ? parents.map(value => <p key={value}>{value}</p>) : <p>확인된 상위 문서가 없습니다.</p>}<p>중첩 포함의 상위 문서도 표시합니다. 속성·조건과 조사 한도에 따라 누락될 수 있습니다.</p></section>
      <section aria-label="참조 검사"><h3>작업 공간 참조 검사</h3>{rows(edges.filter(edge => edge.state !== 'resolved'))}</section>
    </>}
  </>;
  if (embedded) return <section className="graph-workspace" ref={panel} aria-label="그래프 뷰">{content}</section>;
  return <dialog className="recovery-dialog" ref={dialog} aria-label="작업 공간 관계" onCancel={event => { event.preventDefault(); close(); }}>{content}</dialog>;
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseProposal, selectProposal, textDiff, type ProposedChange, type Session, type DocumentSnapshot, type SemanticDiffResult } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import '../../shared/styles/inspector.css';
import { ProposalGenerator } from './proposal-ai';
import { ProposalValidation } from './proposal-validation';
import { ChangeScope } from '../../shared/ui/operation-status';
import { openDialog } from '../../shared/lib/accessibility';
const normalized = (text: string) => text.replace(/\r\n|\r/g, '\n');
export function ProposalPanel({ session, path, draft, restore, close }: { session: Session; path: string; draft(): string | undefined; restore(disk: DocumentSnapshot, text: string, expectedDraft: string | undefined): Promise<string | undefined>; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), serial = useRef(0);
  const [base, setBase] = useState<{ disk: DocumentSnapshot; buffer: string | undefined; text: string }>();
  const [input, setInput] = useState(''), [changes, setChanges] = useState<ProposedChange[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<SemanticDiffResult>(), [approved, setApproved] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('기준 원문을 읽고 있습니다.');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: path });
  useEffect(() => { const restoreFocus = openDialog(dialog.current!); void refresh(); return () => { serial.current++; void window.metis.cancelSemanticDiff({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch }).catch(() => {}); restoreFocus(); }; }, []);
  function invalidate() { setApproved(false); setComparison(undefined); }
  async function refresh() {
    const token = ++serial.current; setBusy(true); setBase(undefined); setChanges([]); setSelected([]); invalidate();
    try { const response = await window.metis.readDocument(scope()); if (token !== serial.current) return;
      if (response.ok) { const buffer = draft(); setBase({ disk: response.value, buffer, text: normalized(buffer ?? response.value.text) }); setMessage('현재 편집 내용 기준입니다. 제안 JSON을 붙여 넣고 검토하세요.'); } else setMessage(response.error.message);
    } catch { if (token === serial.current) setMessage('기준 원문을 읽지 못했습니다.'); } finally { if (token === serial.current) setBusy(false); }
  }
  const preview = useMemo(() => { if (!base) return {}; try { return { text: selectProposal(base.text, changes, selected) }; } catch (error) { return { error: (error as Error).message }; } }, [base, changes, selected]);
  function parse() { if (!base) return; invalidate(); setSelected([]); setChanges([]); try { setChanges(parseProposal(input, base.text)); setMessage('반영할 변경을 선택한 뒤 비교하세요. 기본 선택은 없습니다.'); } catch (error) { setMessage(`제안을 읽지 못했습니다: ${(error as Error).message}`); } }
  async function compare() {
    if (!base || preview.text === undefined) return; const token = ++serial.current; setBusy(true); invalidate();
    try { const response = await window.metis.semanticDiff({ ...scope(), before: base.text, after: preview.text }); if (token !== serial.current) return;
      if (response.ok && response.value.validation?.before && response.value.validation?.after) { setComparison(response.value); setMessage('근거·텍스트 차이·문서 검증 결과와 비교 한계를 검토한 뒤 승인하세요.'); } else setMessage(response.ok ? '변경 전후 문서 검증을 완료하지 못했습니다. 원문을 확인하고 다시 비교하세요.' : response.error.message);
    } catch { if (token === serial.current) setMessage('비교 응답을 받지 못했습니다.'); } finally { if (token === serial.current) setBusy(false); }
  }
  async function apply() {
    if (!base || !approved || !comparison || preview.text === undefined || !selected.length) return;
    setBusy(true); setApproved(false);
    try { const error = await restore(base.disk, preview.text, base.buffer); if (error) { setMessage(error); setComparison(undefined); } else close(); }
    catch { setMessage('초안 반영에 실패했습니다. 원문과 복구 사본을 확인하세요.'); setComparison(undefined); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="recovery-dialog context-dialog" aria-label="변경 제안 검토" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <h2>변경 제안 검토 · {path}</h2><p>AI에 제안을 요청하거나 외부 제안 JSON을 가져올 수 있습니다. 승인한 항목은 편집 초안에 반영하며 디스크 저장은 별도입니다.</p>
    <ChangeScope target={`${path} · 선택한 변경 ${selected.length}개`} basis="현재 편집 버퍼 또는 읽은 저장본과 선택한 제안 비교" effect="전송 승인 → 생성 요청, 반영 승인 → 편집 초안 변경, 문서 저장 → 디스크 변경은 별도 행동입니다." recovery="초안 반영 전에 기존 내용을 복구 사본으로 보존합니다. 실패하면 기준 다시 읽기 후 재검토하세요. 반영 작업은 시작 후 취소할 수 없습니다." />
    <ProposalGenerator session={session} path={path} base={base} busy={busy} start={() => { setBusy(true); setInput(''); setChanges([]); setSelected([]); invalidate(); }} finish={(result, error) => {
      setBusy(false);
      if (!result || !base) { setMessage(error ?? '기준 원문이 없습니다.'); return; }
      if (draft() !== base.buffer) { setMessage('생성 중 편집 내용이 변경되었습니다. 기준을 다시 읽으세요.'); return; }
      try { const empty = JSON.parse(result.json).changes.length === 0; const parsed = empty ? [] : parseProposal(result.json, base.text); setInput(result.json); setChanges(parsed); setMessage(`${empty ? '모델이 변경을 제안하지 않았습니다.' : '생성된 제안을 선택하고 비교하세요. 기본 선택은 없습니다.'} ${result.warnings.join(' ')}`); }
      catch { setMessage('생성된 제안을 검증하지 못했습니다.'); }
    }} />
    <fieldset disabled={busy}><legend>기준과 제안</legend><button onClick={refresh}>기준 다시 읽기</button>
      {base && <p>기준: {base.buffer === undefined ? '저장본' : '현재 편집 버퍼'} · 저장본 리비전 {base.disk.revision}</p>}
      <details><summary>제안 형식</summary><pre>{JSON.stringify({ version: 1, changes: [{ id: 'change-1', before: '이전 원문', after: '수정 원문', reason: '변경 이유', evidence: [{ quote: '기준 원문의 근거 문장' }] }] }, null, 2)}</pre><p>현재 문서 하나만 지원합니다. 이전 원문이 정확히 한 곳과 일치해야 하며 변경 범위가 겹치면 거부합니다. 추가는 주변 원문을 포함한 교체로 표현하세요.</p></details>
      <label>제안 JSON<textarea value={input} maxLength={1024 * 1024} onChange={e => { setInput(e.target.value); setChanges([]); setSelected([]); invalidate(); }} /></label><button disabled={!base || !input} onClick={parse}>제안 읽기</button>
      {changes.map(c => <article key={c.id}><label><input type="checkbox" checked={selected.includes(c.id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id)); invalidate(); }} />변경 {c.id}</label><p>제안 이유 (작성자·모델의 판단): {c.reason}</p>
        <p>변경 위치: {path}:{base!.text.slice(0, c.start).split('\n').length} · 위 기준 원문에 정확히 일치</p>
        <details><summary>근거 인용 ({c.evidence?.length ?? 0})</summary><p>현재 문서의 기준 원문에서 인용 위치를 확인했습니다. 주석·비활성 본문을 포함할 수 있으며 변경 이유의 타당성은 별도 검토가 필요합니다.</p>
          {c.evidence?.length ? c.evidence.map((e, i) => <blockquote key={i}><p>{path}:{e.line} · 기준 원문</p><pre>{e.quote}</pre></blockquote>) : <p>제공된 근거 인용 없음. 변경 대상 원문과 제안 이유를 직접 검토하세요.</p>}
        </details><pre>{textDiff(c.before, c.after)}</pre></article>)}
      {preview.error && <p>{preview.error}</p>}
      {base && changes.length > 0 && preview.text !== undefined && <><h3>선택한 변경의 텍스트 비교</h3><pre>{textDiff(base.text, preview.text)}</pre><details><summary>전체 결과 원문</summary><pre>{preview.text}</pre></details></>}
      <button disabled={!selected.length || preview.text === undefined} onClick={compare}>선택 변경 비교</button>
      {comparison && <section aria-label="제안 비교 결과"><p>의미 변화 {comparison.changes.length}개{comparison.partial && ' · 부분 해석'}{comparison.truncated && ' · 일부 생략'}</p>{comparison.warnings.map(w => <p key={w}>{w}</p>)}<p>비교 결과는 제안의 정확성이나 안전성을 보증하지 않습니다. 포함 본문은 비교하지 않습니다.</p><details><summary>의미 변화 상세</summary>{comparison.changes.map((c, i) => <pre key={i}>{JSON.stringify(c, null, 2)}</pre>)}</details></section>}
      {comparison?.validation?.before && comparison.validation.after && <ProposalValidation before={comparison.validation.before} after={comparison.validation.after} />}
      <label><input type="checkbox" disabled={!comparison} checked={approved} onChange={e => setApproved(e.target.checked)} />선택한 변경과 비교 한계를 확인했고 초안 반영을 승인합니다.</label>
      <button disabled={!approved || !comparison || !selected.length || session.readOnly || base?.disk.readOnly || base?.disk.eol === 'mixed'} onClick={apply}>승인한 변경을 초안에 반영</button>
      <button onClick={close}>전체 거부하고 닫기</button>
    </fieldset><p role="status">{busy ? '처리 중 · 원본 저장은 수행하지 않습니다.' : message}</p>
  </dialog>;
}

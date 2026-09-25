import { openDialog } from './accessibility';
import React, { useEffect, useRef, useState } from 'react';
import { textDiff, type Session, type GitCommit, type SemanticDiffResult, type SemanticUnit } from '@metis/contracts';
import './git.css';
import './recovery.css';
function describe(unit: SemanticUnit) {
  try {
    const value = JSON.parse(unit.value);
    if (unit.category === 'section' && typeof value === 'object') return `제목: ${value.title}\n수준: ${value.level}`;
    if (unit.category === 'block') return [value.title, value.text].filter(Boolean).join('\n');
    if (unit.category === 'attribute') return `${value.name}: ${value.value}\n${value.applied ? '적용' : '미적용'}`;
    if (unit.category === 'include') return value.declaration;
    if (unit.category === 'condition') return `${value.expression}\n${({ active: '활성', inactive: '비활성', unknown: '미확인' } as Record<string, string>)[value.state]}`;
  } catch { /* Plain source values need no formatting. */ }
  return unit.value;
}
export function SemanticPanel({ session, path, draft, close }: { session: Session; path: string; draft(): string | undefined; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), token = useRef(0), left = useRef<HTMLTextAreaElement>(null), right = useRef<HTMLTextAreaElement>(null);
  const [pair, setPair] = useState<{ before: string; after: string; beforeLabel: string; afterLabel: string; revision: string }>();
  const [history, setHistory] = useState<GitCommit[]>([]), [result, setResult] = useState<SemanticDiffResult>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('비교 원문을 읽고 있습니다.');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); void refresh(); return () => { token.current++; void window.metis.cancelSemanticDiff(scope()).catch(() => {}); restoreFocus(); }; }, []);
  async function refresh() {
    const serial = ++token.current; setBusy(true); setPair(undefined); setResult(undefined); setHistory([]);
    try { const disk = await window.metis.readDocument({ ...scope(), relativePath: path }); if (serial !== token.current) return;
      if (!disk.ok) { setMessage(disk.error.message); return; }
      const buffer = draft(); setPair({ before: disk.value.text, after: buffer ?? disk.value.text, beforeLabel: '조회한 디스크', afterLabel: buffer === undefined ? '조회한 디스크' : '조회한 편집 버퍼', revision: disk.value.revision });
      setMessage('조회 시점의 두 원문입니다. 비교를 실행하세요. 원본은 변경하지 않습니다.');
    } catch { if (serial === token.current) setMessage('원문을 읽지 못했습니다.'); } finally { if (serial === token.current) setBusy(false); }
  }
  async function loadHistory() {
    const serial = ++token.current; setBusy(true);
    try { const response = await window.metis.gitFile({ ...scope(), relativePath: path }); if (serial !== token.current) return;
      if (response.ok) { setHistory(response.value.history); setMessage(response.value.history.length ? '이전 원문으로 사용할 커밋을 선택하세요. 이후 원문은 조회한 내용을 유지합니다.' : '이 경로의 커밋 이력이 없습니다.'); } else setMessage(response.error.message);
    } catch { if (serial === token.current) setMessage('Git 이력을 읽지 못했습니다.'); } finally { if (serial === token.current) setBusy(false); }
  }
  async function version(commit: string) {
    const serial = ++token.current; setBusy(true); setResult(undefined);
    try { const response = await window.metis.gitVersion({ ...scope(), relativePath: path, commit }); if (serial !== token.current) return;
      if (response.ok) { setPair(value => value && ({ ...value, before: response.value.text, beforeLabel: `커밋 ${commit}` })); setMessage('이전 원문을 변경했습니다. 다시 비교하세요.'); } else setMessage(response.error.message);
    } catch { if (serial === token.current) setMessage('과거 버전을 읽지 못했습니다.'); } finally { if (serial === token.current) setBusy(false); }
  }
  async function compare() {
    if (!pair) return; const serial = ++token.current; setBusy(true); setResult(undefined); setMessage('의미 변화를 비교하고 있습니다.');
    try { const response = await window.metis.semanticDiff({ ...scope(), relativePath: path, before: pair.before, after: pair.after }); if (serial !== token.current) return;
      if (response.ok) { setResult(response.value); setMessage('의미 비교를 완료했습니다. 텍스트 차이와 함께 확인하세요.'); } else setMessage(`${response.error.message} 텍스트 비교는 아래에서 확인할 수 있습니다.`);
    } catch { if (serial === token.current) setMessage('의미 비교에 실패했습니다. 텍스트 비교를 확인하세요.'); } finally { if (serial === token.current) setBusy(false); }
  }
  function cancel() { token.current++; setBusy(false); setResult(undefined); setMessage('비교를 취소했습니다. 조회한 원문은 유지됩니다.'); void window.metis.cancelSemanticDiff(scope()).catch(() => {}); }
  function jump(side: 'before' | 'after', unit: SemanticUnit) {
    const area = (side === 'before' ? left : right).current; if (!area) return;
    const lines = area.value.split('\n'); const start = lines.slice(0, Math.max(0, unit.line - 1)).reduce((n, line) => n + line.length + 1, 0);
    area.focus(); area.setSelectionRange(start, start + (lines[unit.line - 1]?.length ?? 0)); area.scrollTop = Math.max(0, unit.line - 3) * 20;
    setMessage(`${side === 'before' ? '이전' : '이후'} 조회 원문 ${unit.line}행을 선택했습니다. 현재 편집기는 변경하지 않았습니다.`);
  }
  const categories = { section: '절', block: '블록', attribute: '속성', reference: '참조', include: '포함', condition: '조건' };
  return <dialog ref={dialog} className="recovery-dialog git-dialog" aria-label="의미·텍스트 비교" onCancel={event => { event.preventDefault(); close(); }}>
    <h2>의미·텍스트 비교 · {path}</h2><p>로컬 조회 전용 · 외부 전송 없음 · 자동 갱신 없음. 포함 파일의 과거 내용은 비교하지 않습니다.</p>
    <div className="tools"><button disabled={busy} onClick={refresh}>원문 다시 읽기</button><button disabled={busy || !pair} onClick={loadHistory}>과거 버전 선택</button><button disabled={busy || !pair} onClick={compare}>의미 비교</button>{busy && <button onClick={cancel}>비교 취소</button>}<button onClick={close}>닫기</button></div>
    <p role="status">{message}</p>
    {history.length > 0 && <details open><summary>이전 원문으로 사용할 버전</summary>{history.map(item => <p key={item.id}><button disabled={busy} onClick={() => version(item.id)}>{item.id.slice(0, 8)} · {item.subject}</button></p>)}</details>}
    {pair && <><p>이전: {pair.beforeLabel} → 이후: {pair.afterLabel}</p><details><summary>조회한 디스크 리비전</summary>{pair.revision}</details>
      <section aria-label="텍스트 비교"><h3>Text Diff</h3><p>동일한 앞뒤를 제외한 교체 구간입니다. 추가·삭제 각각 150줄, 줄당 1,000자 한도이며 줄바꿈 형식 차이는 제외합니다.</p><pre>{textDiff(pair.before, pair.after)}</pre></section>
      {result && <section aria-label="의미 비교 결과"><h3>Semantic Diff · {result.changes.length}개</h3><ul>{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>{result.partial && <p className="notice">해석 한계가 있는 부분 비교입니다. 전체 의미가 같거나 다르다고 단정하지 않습니다.</p>}{result.truncated && <p role="alert">의미 결과 한도에 도달했습니다. 텍스트 비교를 확인하세요.</p>}
        {!result.changes.length && <p>{result.partial ? '확정할 의미 비교 결과가 없습니다. 텍스트 차이를 확인하세요.' : '관찰한 구조·블록에서 변경을 찾지 못했습니다. 텍스트 차이도 확인하세요.'}</p>}
        {result.changes.map((change, i) => <article key={i}><h4>{categories[(change.after ?? change.before)!.category]} · {{ added: '추가', removed: '삭제', modified: '변경' }[change.kind]}</h4>{change.before && <><button onClick={() => jump('before', change.before!)}>이전 원문: {change.before.line}행</button><pre>{describe(change.before)}</pre></>}{change.after && <><button onClick={() => jump('after', change.after!)}>이후 원문: {change.after.line}행</button><pre>{describe(change.after)}</pre></>}</article>)}
      </section>}
      <div className="comparison"><label>이전 비교 원문<textarea ref={left} readOnly value={pair.before} /></label><label>이후 비교 원문<textarea ref={right} readOnly value={pair.after} /></label></div></>}
  </dialog>;
}

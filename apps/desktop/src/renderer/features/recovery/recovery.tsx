import { TaskSurface } from '../../shared/ui/dialog-shell';
import { useReviewApi } from '../../shared/model/workspace-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { validFolderName, type RecoveryList, type RecoveryContent, type RecoveryEntry, type RecoveryRequest, type Session } from '@metis/contracts';
import '../../shared/styles/dialog.css';
export function RecoveryPanel({ session, close }: { session: Session; close(): void }) {
  const api = useReviewApi();
  const [list, setList] = useState<RecoveryList>(), [content, setContent] = useState<RecoveryContent>(), [name, setName] = useState('recovered.adoc'), [message, setMessage] = useState('목록을 읽고 있습니다.'), [busy, setBusy] = useState(false);
  const token = useRef(0); const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { void refresh(); return () => { token.current++;  }; }, []);
  async function refresh() { const serial = ++token.current; setContent(undefined); try { const result = await api.listRecovery(scope()); if (serial !== token.current) return; if (result.ok) { setList(result.value); setMessage(result.value.entries.length ? '사본을 선택해 내용을 확인하세요.' : '현재 작업 공간의 복구 사본이 없습니다.'); } else setMessage(result.error.message); } catch { setMessage('복구 목록을 읽지 못했습니다.'); } }
  async function read(entry: RecoveryEntry, variant: RecoveryRequest['variant']) { const serial = ++token.current; setContent(undefined); try { const result = await api.readRecovery({ ...scope(), recoveryId: entry.id, variant }); if (serial !== token.current) return; if (result.ok) { setContent(result.value); setMessage(`${entry.relativePath} · ${variant} 사본`); } else setMessage(result.error.message); } catch { setMessage('복구 사본을 읽지 못했습니다.'); } }
  async function restore() { if (!content) return; setBusy(true); try { const result = await api.copyDocument({ ...scope(), relativePath: '', name, text: content.text }); setMessage(result.ok ? `새 파일 ${result.value.relativePath}에 복원했습니다. 기존 파일과 사본은 유지됩니다.` : result.error.message); } catch { setMessage('복원 응답을 확인하지 못했습니다. 파일을 확인해 주세요.'); } finally { setBusy(false); } }
  return <TaskSurface title="복구 사본" close={close} canClose={!busy} auxiliary={<button disabled={busy} onClick={() => void api.recoveryFolder({ requestId: crypto.randomUUID() })}>복구 폴더 열기</button>} actions={<><button disabled={busy} onClick={refresh}>목록 새로 고침</button>{content && <button className="primary" disabled={busy || !validFolderName(name) || !/\.adoc$/i.test(name)} onClick={restore}>작업 공간 루트에 새 파일로 복원</button>}</>}><p>현재 작업 공간의 보존 기록입니다. 완료 기록도 최신 원본과 다를 수 있습니다. 기존 파일은 덮어쓰지 않습니다.</p>
    <p role="status">{message}</p>{list?.warning && <p>{list.warning}</p>}
    <div className="master-detail"><div className="master-list">{list?.entries.map(entry => <article key={entry.id}><strong>{entry.relativePath}</strong><p>{entry.createdAt} · {{ saved: '저장 완료 기록', incomplete: '저장 완료 미확인', draft: '편집 보존' }[entry.state]}</p>{entry.variants.map(variant => <button disabled={busy} key={variant} onClick={() => read(entry, variant)}>{{ before: '저장 전', edited: '편집 사본', displaced: '교체 당시 원본' }[variant]}</button>)}</article>)}
    </div><div className="detail-pane">{!content && <p className="task-empty">왼쪽에서 사본을 선택해 내용을 확인하세요.</p>}{content && <><textarea aria-label="복구 내용" readOnly value={content.text} /><label>새 파일 이름<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label></>}</div></div>
  </TaskSurface>;
}

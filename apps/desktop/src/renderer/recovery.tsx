import { openDialog } from './accessibility';
import React, { useEffect, useRef, useState } from 'react';
import { validFolderName, type RecoveryList, type RecoveryContent, type RecoveryEntry, type RecoveryRequest, type Session } from '@metis/contracts';
import './recovery.css';
export function RecoveryPanel({ session, close }: { session: Session; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), [list, setList] = useState<RecoveryList>(), [content, setContent] = useState<RecoveryContent>(), [name, setName] = useState('recovered.adoc'), [message, setMessage] = useState('목록을 읽고 있습니다.'), [busy, setBusy] = useState(false);
  const token = useRef(0); const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); void refresh(); return () => { token.current++; restoreFocus(); }; }, []);
  async function refresh() { const serial = ++token.current; setContent(undefined); try { const result = await window.metis.listRecovery(scope()); if (serial !== token.current) return; if (result.ok) { setList(result.value); setMessage(result.value.entries.length ? '사본을 선택해 내용을 확인하세요.' : '현재 작업 공간의 복구 사본이 없습니다.'); } else setMessage(result.error.message); } catch { setMessage('복구 목록을 읽지 못했습니다.'); } }
  async function read(entry: RecoveryEntry, variant: RecoveryRequest['variant']) { const serial = ++token.current; setContent(undefined); try { const result = await window.metis.readRecovery({ ...scope(), recoveryId: entry.id, variant }); if (serial !== token.current) return; if (result.ok) { setContent(result.value); setMessage(`${entry.relativePath} · ${variant} 사본`); } else setMessage(result.error.message); } catch { setMessage('복구 사본을 읽지 못했습니다.'); } }
  async function restore() { if (!content) return; setBusy(true); try { const result = await window.metis.copyDocument({ ...scope(), relativePath: '', name, text: content.text }); setMessage(result.ok ? `새 파일 ${result.value.relativePath}에 복원했습니다. 기존 파일과 사본은 유지됩니다.` : result.error.message); } catch { setMessage('복원 응답을 확인하지 못했습니다. 파일을 확인해 주세요.'); } finally { setBusy(false); } }
  return <dialog ref={dialog} className="recovery-dialog" aria-label="복구 사본" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>복구 사본</h2><p>현재 작업 공간의 보존 기록입니다. 완료 기록도 최신 원본과 다를 수 있습니다. 기존 파일은 덮어쓰지 않습니다.</p>
    <div className="tools"><button disabled={busy} onClick={close}>닫기</button><button disabled={busy} onClick={refresh}>목록 새로 고침</button></div><p role="status">{message}</p>{list?.warning && <p>{list.warning}</p>}
    {!content && list?.entries.map(entry => <article key={entry.id}><strong>{entry.relativePath}</strong><p>{entry.createdAt} · {{ saved: '저장 완료 기록', incomplete: '저장 완료 미확인', draft: '편집 보존' }[entry.state]}</p>{entry.variants.map(variant => <button key={variant} onClick={() => read(entry, variant)}>{{ before: '저장 전', edited: '편집 사본', displaced: '교체 당시 원본' }[variant]}</button>)}</article>)}
    {content && <><textarea aria-label="복구 내용" readOnly value={content.text} /><label>새 파일 이름<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !validFolderName(name) || !/\.adoc$/i.test(name)} onClick={restore}>작업 공간 루트에 새 파일로 복원</button></>}
  </dialog>;
}

import { openDialog } from '../../shared/lib/accessibility';
import React, { useEffect, useRef, useState } from 'react';
import { textDiff, validFolderName, type Session, type GitStatus, type GitFile, type GitVersion, type DocumentSnapshot } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import '../../shared/styles/change-review.css';
import { ChangeScope, OperationStatus } from '../../shared/ui/operation-status';
export function GitPanel({ session, initialPath, draft, restore, close }: { session: Session; initialPath?: string; draft(path: string): string | undefined; restore(disk: DocumentSnapshot, text: string, expectedDraft: string | undefined): Promise<string | undefined>; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0);
  const [status, setStatus] = useState<GitStatus>(), [file, setFile] = useState<GitFile>(), [version, setVersion] = useState<GitVersion>();
  const [path, setPath] = useState(initialPath ?? ''), [buffer, setBuffer] = useState<string>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('Git 상태를 읽고 있습니다.');
  const [reviewed, setReviewed] = useState(false);
  const [copyName, setCopyName] = useState('restored.adoc');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); void refresh(); return () => { generation.current++; restoreFocus(); }; }, []);
  async function refresh() {
    const token = ++generation.current; setBusy(true); setStatus(undefined); setFile(undefined); setVersion(undefined); setReviewed(false);
    try { const result = await window.metis.gitStatus(scope()); if (token !== generation.current) return; if (result.ok) { setStatus(result.value); setMessage('저장본의 Git 상태입니다. 파일을 선택하거나 경로를 입력하세요.'); } else setMessage(result.error.message); }
    catch { if (token === generation.current) setMessage('Git 상태를 읽지 못했습니다.'); } finally { if (token === generation.current) setBusy(false); }
  }
  async function inspect(relativePath: string) {
    const token = ++generation.current; setBusy(true); setFile(undefined); setVersion(undefined); setReviewed(false); setPath(relativePath);
    try { const result = await window.metis.gitFile({ ...scope(), relativePath }); if (token !== generation.current) return; if (result.ok) { setFile(result.value); setBuffer(draft(relativePath)); setMessage('조회 시점의 내용입니다. 복원 전에 과거 버전과 디스크·편집 내용을 검토하세요.'); } else setMessage(result.error.message); }
    catch { if (token === generation.current) setMessage('문서 이력을 읽지 못했습니다.'); } finally { if (token === generation.current) setBusy(false); }
  }
  async function history(commit: string) {
    if (!file) return;
    const token = ++generation.current; setBusy(true); setVersion(undefined); setReviewed(false);
    try { const result = await window.metis.gitVersion({ ...scope(), relativePath: file.relativePath, commit }); if (token !== generation.current) return; if (result.ok) setVersion(result.value); else setMessage(result.error.message); }
    catch { if (token === generation.current) setMessage('과거 버전을 읽지 못했습니다.'); } finally { if (token === generation.current) setBusy(false); }
  }
  async function apply() {
    if (!file?.disk || !version || !reviewed) return; setBusy(true);
    try { const error = await restore(file.disk, version.text, buffer); if (error) { setMessage(error); setReviewed(false); } else close(); }
    catch { setMessage('복원 초안을 적용하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function copy() {
    if (!version || !reviewed) return; setBusy(true);
    try { const result = await window.metis.copyDocument({ ...scope(), relativePath: '', name: copyName, text: version.text }); setMessage(result.ok ? `${result.value.relativePath}에 과거 버전 사본을 저장했습니다. 파일 탐색을 새로 고침하면 확인할 수 있습니다.` : result.error.message); if (result.ok) setReviewed(false); }
    catch { setMessage('사본 생성 결과를 확인하지 못했습니다. 파일을 확인하세요.'); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="recovery-dialog git-dialog" aria-label="Git 변경과 이력" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>Git 변경과 이력</h2><p>디스크 저장본·스테이지·커밋·미저장 편집을 구분합니다. 저장과 커밋·원격 전송은 별도 작업입니다.</p>
    <div className="tools"><button disabled={busy} onClick={close}>닫기</button><button disabled={busy} onClick={refresh}>Git 새로 고침</button></div>{busy ? <OperationStatus task="Git 작업" phase="running" message="진행 중에는 취소할 수 없습니다. 완료 후 결과를 확인하세요." /> : <p role="status">{message}</p>}
    {status && <section aria-label="Git 변경 목록"><h3>저장본 변경</h3><p>왼쪽 코드: 스테이지 / 오른쪽: 디스크. M 수정 · A 추가 · D 삭제 · U 충돌 · ? 미추적. 이름 변경은 삭제·추가로 표시합니다.</p>
      {status.partial && <p>변경 목록은 최대 500개입니다.</p>}{!status.changes.length && <p>변경된 AsciiDoc 문서가 없습니다.</p>}
      <ul>{status.changes.map(item => <li key={item.relativePath}><button disabled={busy} onClick={() => inspect(item.relativePath)}><code>{item.index}{item.worktree}</code> {item.relativePath}</button></li>)}</ul>
    </section>}
    <form onSubmit={event => { event.preventDefault(); void inspect(path); }}><label>문서 경로<input value={path} disabled={busy} onChange={event => setPath(event.target.value)} /></label><button disabled={busy || !/\.adoc$/i.test(path)}>문서 이력 조회</button></form>
    {file && <><h3>{file.relativePath}</h3>{file.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      <section aria-label="Git Diff"><h3>Diff · 텍스트 변경 구간</h3><p>동일한 앞뒤 줄을 제외한 교체 구간입니다. 각 추가·삭제 150줄, 줄당 1,000자까지만 표시합니다. 전체 내용은 아래에서 확인하세요.</p>
        <details><summary>HEAD → 스테이지</summary><pre>{textDiff(file.head, file.staged)}</pre><div className="comparison"><label>HEAD 내용<textarea readOnly value={file.head ?? 'HEAD에 파일 없음'} /></label><label>스테이지 내용<textarea readOnly value={file.staged ?? '스테이지 내용 없음'} /></label></div></details>
        <details open><summary>스테이지 → 디스크</summary><pre>{textDiff(file.staged, file.disk?.text)}</pre></details>
        <details><summary>디스크 → 현재 편집</summary><pre>{buffer === undefined ? '열린 편집 버퍼가 없습니다.' : textDiff(file.disk?.text, buffer)}</pre></details>
      </section>
      <section aria-label="Git History"><h3>History · 현재 경로의 최근 이력</h3>{!file.history.length && <p>이 경로의 커밋 이력이 없습니다.</p>}<ul>{file.history.map(commit => <li key={commit.id}><button disabled={busy} aria-pressed={version?.commit === commit.id} onClick={() => history(commit.id)}>{commit.id.slice(0, 8)} · {commit.date} · {commit.subject}</button></li>)}</ul></section>
      <div className="comparison"><label>조회한 디스크<textarea readOnly value={file.disk?.text ?? '디스크에 파일 없음'} /></label><label>조회한 편집 버퍼<textarea readOnly value={buffer ?? '열린 편집 버퍼 없음'} /></label>{version && <label>선택한 과거 버전<textarea readOnly value={version.text} /></label>}</div>
      {version && <section aria-label="Git 복원 검토"><h3>복원 검토 · {version.commit.slice(0, 8)}</h3><pre>{textDiff(file.disk?.text, version.text)}</pre>
        <ChangeScope target={file.relativePath} basis={`조회한 디스크·편집 버퍼와 커밋 ${version.commit.slice(0, 8)}`} effect="복원 초안 적용은 편집 버퍼만 변경합니다. 새 파일로 복원은 입력한 이름의 파일을 즉시 생성합니다. 커밋·원격 전송은 수행하지 않습니다." recovery="초안 반영은 기존 내용을 복구 사본으로 보존합니다. 같은 이름의 파일은 덮어쓰지 않습니다. 실패 시 Git 새로 고침 후 다시 검토하세요." />
        <p>현재 편집(열려 있지 않으면 디스크 내용)을 복구 사본으로 보존한 뒤 과거 버전을 편집 초안에 적용합니다. 파일 저장은 편집기에서 별도로 실행하세요.</p>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />디스크·편집·과거 버전의 내용을 검토했습니다.</label>
        <button disabled={busy || !reviewed || !file.disk || file.disk.readOnly || file.disk.eol === 'mixed' || session.readOnly} onClick={apply}>편집 보존 후 복원 초안 적용</button>
        <div><label>과거 버전 사본 이름<input value={copyName} disabled={busy} onChange={event => setCopyName(event.target.value)} /></label><button disabled={busy || !reviewed || session.readOnly || !validFolderName(copyName) || !/\.adoc$/i.test(copyName)} onClick={copy}>루트에 새 파일로 복원</button><p>삭제된 문서도 새 파일로 복원할 수 있습니다. 같은 이름이 있으면 덮어쓰지 않습니다.</p></div>
      </section>}
    </>}
  </dialog>;
}

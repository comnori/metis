import { openDialog } from '../../shared/lib/accessibility';
import React, { useEffect, useRef, useState } from 'react';
import type { DocumentSnapshot } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import { ChangeScope, OperationStatus } from '../../shared/ui/operation-status';
export function Conflict({ baseline, disk, text, close, resolve }: { baseline: DocumentSnapshot; disk: DocumentSnapshot; text: string; close(): void; resolve(text: string, useDisk: boolean): Promise<string | undefined> }) {
  const dialog = useRef<HTMLDialogElement>(null), [merged, setMerged] = useState(text), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); return () => restoreFocus(); }, []);
  async function apply(useDisk: boolean) { setBusy(true); setError(''); try { const message = await resolve(merged, useDisk); if (message) setError(message); else close(); } catch { setError('해결을 완료하지 못했습니다. 편집 내용은 유지됩니다.'); } finally { setBusy(false); } }
  return <dialog ref={dialog} className="recovery-dialog" aria-label="충돌 비교" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>변경 비교 · {baseline.relativePath}</h2><p>기준 원문과 디스크를 비교해 해결안을 편집하세요. 기존 편집은 복구 사본으로 보존합니다. 원본이 다시 바뀌면 저장을 거절합니다.</p>
    <ChangeScope target={baseline.relativePath} basis="편집 기준 · 비교한 디스크 · 직접 편집한 해결안" effect="디스크 사용은 편집 내용을 교체합니다. 해결안 저장은 이 파일의 디스크 원문을 변경합니다." recovery="두 작업 모두 기존 편집을 먼저 복구 사본으로 보존합니다. 복구 사본·복구 폴더에서 확인할 수 있습니다." />
    <div className="comparison"><label>편집 기준<textarea readOnly value={baseline.text} /></label><label>비교한 디스크<textarea readOnly value={disk.text} /></label><label>해결안<textarea disabled={busy} value={merged} onChange={event => setMerged(event.target.value)} /></label></div>
    {(busy || error) && <OperationStatus task="충돌 해결" phase={busy ? 'running' : 'failed'} message={busy ? '보존·반영 중에는 취소할 수 없습니다. 완료를 기다리세요.' : error} next={error && !busy ? '‘취소’로 비교를 닫고 ‘외부 변경 확인’ 후 새 비교를 여세요. 보존한 편집은 ‘도구·보기’ 또는 명령 팔레트의 ‘복구 사본’에서 확인하세요.' : undefined} />}<div className="tools"><button disabled={busy} onClick={close}>취소</button><button disabled={busy} onClick={() => apply(true)}>편집 보존 후 디스크 사용</button><button disabled={busy || disk.readOnly || disk.eol === 'mixed'} onClick={() => apply(false)}>해결안 저장</button></div>
  </dialog>;
}

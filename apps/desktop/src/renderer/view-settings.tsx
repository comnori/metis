import React, { useEffect, useRef, useState } from 'react';
import { openDialog } from './accessibility';
import { defaultLayout } from './layout';
export function ViewSettings({ value, update, close, warning }: { value: typeof defaultLayout; update(value: typeof defaultLayout): void; close(): void; warning: string }) {
  const dialog = useRef<HTMLDialogElement>(null), [query, setQuery] = useState(''), [previous, setPrevious] = useState<typeof defaultLayout>();
  useEffect(() => openDialog(dialog.current!), []);
  const matches = (label: string) => !query.trim() || label.includes(query.trim());
  const files = matches('파일 패널 표시 너비'), outline = matches('목차 패널 표시 너비');
  return <dialog ref={dialog} className="recovery-dialog view-settings" aria-label="보기 설정" onCancel={e => { e.preventDefault(); close(); }}>
    <h2>보기 설정</h2><p>현재 작업 공간의 파일·목차 배치에 즉시 적용됩니다. 작업 공간을 열기 전에는 현재 창의 기본 보기 설정입니다. 좁은 창의 패널 열기는 임시 상태이며 원문은 변경하지 않습니다.</p>
    <label>설정 검색<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {files && <fieldset><legend>파일 패널</legend><label><input type="checkbox" checked={value.files} onChange={e => update({ ...value, files: e.target.checked })} />넓은 창에서 파일 패널 표시</label><label>파일 패널 너비 {value.fileWidth}px<input type="range" min="180" max="360" step="10" value={value.fileWidth} onChange={e => update({ ...value, fileWidth: Number(e.target.value) })} /></label></fieldset>}
    {outline && <fieldset><legend>목차 패널</legend><label><input type="checkbox" checked={value.outline} onChange={e => update({ ...value, outline: e.target.checked })} />넓은 창에서 목차 패널 표시</label><label>목차 패널 너비 {value.outlineWidth}px<input type="range" min="140" max="300" step="10" value={value.outlineWidth} onChange={e => update({ ...value, outlineWidth: Number(e.target.value) })} /></label></fieldset>}
    {!files && !outline && <p role="status">일치하는 보기 설정이 없습니다. 검색어를 지우거나 파일·목차·너비로 검색하세요.</p>}
    <p role="status">{warning || '설정은 이 앱의 로컬 설정에 저장됩니다. 초기화는 보기 설정만 변경합니다.'}</p>
    <div className="tools"><button onClick={() => { setPrevious({ ...value }); update({ ...defaultLayout }); }}>보기 기본값 복원</button><button disabled={!previous} onClick={() => { if (previous) update(previous); setPrevious(undefined); }}>초기화 이전 값 복원</button><button onClick={close}>닫기</button></div>
    <p>이전 값 복원은 이 창에서 마지막으로 초기화하기 직전의 보기 설정 전체를 복원합니다. 창을 닫으면 복원 기록은 사라집니다. OS 고대비·움직임 감소 설정은 자동으로 따릅니다.</p>
  </dialog>;
}

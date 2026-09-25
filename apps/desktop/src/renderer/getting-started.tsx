import { openDialog } from './accessibility';
import React, { useEffect, useRef } from 'react';
import './getting-started.css';
export function GettingStarted({ workspace, documentPath, readOnly, close, showHints }: { workspace?: string; documentPath?: string; readOnly?: boolean; close(): void; showHints(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <GuideDialog dialogRef={ref} close={close}>
    <h2>시작 안내</h2>
    <p>{workspace ? `현재 작업 공간: ${workspace}` : '먼저 문서를 보관할 폴더를 여세요.'}{documentPath && ` · 현재 문서: ${documentPath}`}</p>
    {readOnly && <p>현재 작업 공간은 읽기 전용입니다. 문서를 읽을 수 있지만 새 문서 작성과 저장에는 쓰기 가능한 폴더가 필요합니다.</p>}
    <ol>
      <li><strong>폴더 선택</strong><p>‘폴더 열기’로 기존 폴더를 사용하거나 ‘새 작업 공간’으로 빈 폴더를 만드세요. 계정이나 AI 서버는 필요하지 않습니다.</p></li>
      <li><strong>문서 만들기</strong><p>빈 화면의 ‘이 폴더에 문서 만들기’ 또는 파일 패널의 ‘새 문서’를 사용하세요. 이름은 <code>first-note.adoc</code>처럼 입력합니다. 만들기는 빈 파일을 생성하며 같은 이름이 있으면 덮어쓰지 않습니다.</p></li>
      <li><strong>작성하고 저장</strong><p>원문에 제목과 본문을 입력한 뒤 ‘저장’ 또는 Ctrl/Cmd+S를 누르세요. ‘저장하지 않은 변경’은 아직 디스크에 기록되지 않은 편집입니다. 미리보기는 저장 동작이 아닙니다.</p></li>
      <li><strong>다시 열기</strong><p>저장 후 문서 탭을 닫고 파일 패널에서 다시 선택하세요. 파일 패널이 접혀 있으면 상단 ‘파일 패널’을 누르거나 Ctrl/Cmd+P로 빠른 열기를 사용하세요.</p></li>
    </ol>
    <details><summary>읽기 전용 AsciiDoc 예제</summary><p>학습용 표시입니다. 아래 내용을 확인하는 것만으로 파일이 생성되거나 현재 문서에 삽입되지 않습니다. 필요하면 선택해 복사하여 직접 작성하세요.</p><pre tabIndex={0} aria-label="학습용 예제 원문">{'= 나의 첫 문서\n\n== 오늘의 기록\n\n배운 내용을 적습니다.\n\nNOTE: 저장한 원문은 일반 텍스트 편집기에서도 열 수 있습니다.'}</pre></details>
    <details><summary>포함·탐색·변경 검토 도움말</summary><p>포함 문서는 목차의 ‘포함 원문 열기’에서 실제 파일을 확인하세요. 검색은 저장본을 기준으로 하므로 미저장 편집의 위치와 다를 수 있습니다.</p><p>외부 변경과 충돌하면 비교 후 유지할 내용을 선택하세요. AI·Agent의 전송 승인, 초안 반영 승인, 디스크 저장은 각각 별도입니다. 필요한 도구는 ‘도구·보기’ 또는 명령 팔레트에서 찾을 수 있습니다.</p></details>
    <div className="tools"><button onClick={showHints}>시작 화면 안내 다시 표시</button><button autoFocus onClick={close}>닫기</button></div>
  </GuideDialog>;
}
function GuideDialog({ dialogRef, close, children }: { dialogRef: React.RefObject<HTMLDialogElement | null>; close(): void; children: React.ReactNode }) {
  useEffect(() => { const node = dialogRef.current!; const restoreFocus = openDialog(node); return () => { restoreFocus(); }; }, []);
  return <dialog ref={dialogRef} className="recovery-dialog getting-started" aria-label="시작 안내" onCancel={e => { e.preventDefault(); close(); }}>{children}</dialog>;
}

import { openDialog, platformShortcut } from '../../shared/lib/accessibility';
import React, { useEffect, useRef } from 'react';
import './getting-started.css';
export function GettingStarted({ workspace, documentPath, readOnly, close, showHints }: { workspace?: string; documentPath?: string; readOnly?: boolean; close(): void; showHints(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <GuideDialog dialogRef={ref} close={close}>
    <h2>시작 안내</h2>
    <p>{workspace ? `현재 작업 공간: ${workspace}` : '먼저 문서를 보관할 폴더를 여세요.'}{documentPath && ` · 현재 문서: ${documentPath}`}</p>
    {readOnly && <p>현재 작업 공간은 읽기 전용입니다. 문서를 읽을 수 있지만 새 문서 작성과 저장에는 쓰기 가능한 폴더가 필요합니다.</p>}
    <ol>
      <li><strong>폴더 선택</strong><p>‘폴더 열기’로 기존 폴더를 사용하거나 ‘새 작업 공간’으로 빈 폴더를 만드세요. 새 작업 공간 자체가 Git 저장소가 아니면 초기화 여부를 묻습니다. 기존 폴더와 최근 폴더를 열 때는 묻지 않습니다. 계정이나 AI 서버는 필요하지 않습니다.</p></li>
      <li><strong>문서 만들기</strong><p>빈 화면의 ‘이 폴더에 문서 만들기’ 또는 파일 패널의 ‘새 문서’를 사용하세요. 이름은 <code>first-note.adoc</code>처럼 입력합니다. 만들기는 빈 파일을 생성하며 같은 이름이 있으면 덮어쓰지 않습니다.</p></li>
      <li><strong>작성하고 저장</strong><p>원문에 제목과 본문을 입력한 뒤 ‘저장’ 또는 {platformShortcut('Ctrl/Cmd+S')}를 누르세요. ‘저장하지 않은 변경’은 아직 디스크에 기록되지 않은 편집입니다. 미리보기는 저장 동작이 아닙니다.</p></li>
      <li><strong>다시 열기</strong><p>저장 후 문서 탭을 닫고 파일 패널에서 다시 선택하세요. 파일 패널이 접혀 있으면 상단 ‘파일 패널’을 누르거나 {platformShortcut('Ctrl/Cmd+P')}로 빠른 열기를 사용하세요.</p></li>
    </ol>
    <details><summary>읽기 전용 AsciiDoc 예제</summary><p>학습용 표시입니다. 아래 내용을 확인하는 것만으로 파일이 생성되거나 현재 문서에 삽입되지 않습니다. 필요하면 선택해 복사하여 직접 작성하세요.</p><pre tabIndex={0} aria-label="학습용 예제 원문">{'= 나의 첫 문서\n\n== 오늘의 기록\n\n배운 내용을 적습니다.\n\nNOTE: 저장한 원문은 일반 텍스트 편집기에서도 열 수 있습니다.'}</pre></details>
    <details><summary>포함·탐색·보기 설정 도움말</summary><p>포함 문서는 목차의 ‘포함 원문 열기’에서 실제 파일을 확인하세요. 검색은 저장본을 기준으로 하므로 미저장 편집의 위치와 다를 수 있습니다. 검색어와 결과 필터는 같은 작업 공간에서 다시 열면 복원됩니다. 결과가 숨겨졌다면 ‘필터 초기화’를 누르세요.</p><p>검색·빠른 열기·보기 설정은 Escape 한 번으로 닫습니다. 글자 조합 중에는 창을 유지합니다. 검색어를 지우려면 입력에서 전체 선택 후 삭제하세요. 탭을 오가던 위치는 명령 팔레트의 ‘탐색 뒤로’·‘탐색 앞으로’로 찾을 수 있습니다.</p><p>‘보기 설정’에서 작업 공간별 UI·AsciiDoc 글꼴과 미리보기 테마를 선택할 수 있습니다. 사용자 CSS는 미리보기 안에만 적용되며 외부 URL과 @import는 차단됩니다. ‘보기 기본값 복원’은 패널·글꼴·테마를 초기화하고 CSS 적용을 끄지만 파일 연결은 유지합니다. 같은 창을 닫기 전에는 ‘초기화 이전 값 복원’으로 되돌릴 수 있으며 문서 원문은 바뀌지 않습니다.</p></details>
    <details><summary>저장·충돌·AI 승인 구분</summary><p>외부 변경이 감지되면 ‘외부 변경 확인’ 후 비교하세요. ‘편집 보존 후 디스크 사용’은 편집 내용을 디스크 내용으로 바꾸고, ‘해결안 저장’은 해결안을 디스크에 기록합니다. 기존 편집은 먼저 복구 사본으로 보존합니다.</p><table><caption>AI·Agent 요청과 변경 반영</caption><thead><tr><th scope="col">행동</th><th scope="col">결과</th></tr></thead><tbody><tr><th scope="row">전송 승인</th><td>범위를 승인한 뒤 실행 버튼을 누르면 확인한 원문 또는 발췌를 지정한 서버에 보냅니다.</td></tr><tr><th scope="row">초안 반영 승인</th><td>승인 후 ‘승인한 변경을 초안에 반영’을 누르면 선택한 변경이 초안에 적용됩니다. 디스크 저장은 하지 않습니다.</td></tr><tr><th scope="row">문서 저장</th><td>편집 내용을 디스크에 기록합니다.</td></tr></tbody></table><p>로컬 파일 편집에는 AI 서버가 필요하지 않습니다. 필요한 도구와 ‘복구 사본’은 ‘도구·보기’ 또는 명령 팔레트에서 찾을 수 있습니다.</p></details>
    <div className="tools"><button onClick={showHints}>시작 화면 안내 다시 표시</button><button autoFocus onClick={close}>닫기</button></div>
  </GuideDialog>;
}
function GuideDialog({ dialogRef, close, children }: { dialogRef: React.RefObject<HTMLDialogElement | null>; close(): void; children: React.ReactNode }) {
  useEffect(() => { const node = dialogRef.current!; const restoreFocus = openDialog(node); return () => { restoreFocus(); }; }, []);
  return <dialog ref={dialogRef} className="recovery-dialog getting-started" aria-label="시작 안내" onCancel={e => { e.preventDefault(); close(); }}>{children}</dialog>;
}

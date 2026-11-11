import React, { useState } from 'react';
import { platformShortcut } from '../../shared/lib/accessibility';
import { TaskSurface } from '../../shared/ui/dialog-shell';
import './getting-started.css';
const topics = [
  { id: 'start', title: '첫 문서 작성', terms: '시작 폴더 작업 공간 만들기 저장 다시 열기' },
  { id: 'writing', title: '문서 작성과 탐색', terms: 'AsciiDoc 원문 미리보기 포함 검색 파일 글꼴 테마 설정' },
  { id: 'attachments', title: '첨부파일', terms: '이미지 오디오 비디오 PDF 붙여넣기 드롭 assets' },
  { id: 'recovery', title: '저장과 복구', terms: '충돌 복원 사본 Git 이력 디스크 초안' },
  { id: 'review', title: 'AI와 변경 검토', terms: '모델 서버 승인 전송 제안 근거 Agent' },
  { id: 'shortcuts', title: '키보드 단축키', terms: '명령 팔레트 빠른 열기 검색 저장 Esc Escape' }
];
export function GettingStarted({ workspace, documentPath, readOnly, close, showHints, execute }: { workspace?: string; documentPath?: string; readOnly?: boolean; close(): void; showHints(): void; execute?(id: string): void }) {
  const [query, setQuery] = useState(''), [topic, setTopic] = useState('start');
  const results = topics.filter(item => `${item.title} ${item.terms}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const action = (id: string, label: string, needsWorkspace = true) => { const needsDocument = id.startsWith('document.') || id === 'proposal.open'; const reason = needsWorkspace && !workspace ? '작업 공간을 먼저 여세요.' : needsDocument && !documentPath ? '문서를 먼저 여세요.' : readOnly && (id === 'workspace.newDocument' || id === 'document.attachment') ? '읽기 전용 작업 공간입니다.' : undefined; return <button disabled={!!reason} title={reason} onClick={() => execute?.(id)}>{label}</button>; };
  return <TaskSurface title="도움말" close={close} auxiliary={<button onClick={showHints}>시작 화면 안내 다시 표시</button>}>
    <div className="help-layout"><nav aria-label="도움말 주제"><label>도움말 검색<input type="search" value={query} placeholder="무엇을 하고 싶으세요?" onChange={e => setQuery(e.target.value)} /></label>{results.map(item => <button key={item.id} aria-current={topic === item.id ? 'page' : undefined} onClick={() => { setTopic(item.id); setQuery(''); }}>{item.title}</button>)}{!results.length && <p role="status">일치하는 주제가 없습니다. 저장·첨부파일·단축키로 검색하세요.</p>}</nav>
    <article className="help-article"><h3>{topics.find(item => item.id === topic)?.title}</h3>
      {topic === 'start' && <><p>문서는 선택한 폴더에 일반 AsciiDoc 파일로 저장됩니다. 계정이나 AI 서버 없이 시작할 수 있습니다.</p>{readOnly && <p className="notice">현재 작업 공간은 읽기 전용입니다. 새 문서를 만들려면 쓰기 가능한 폴더를 여세요.</p>}<ol><li><strong>폴더 선택</strong><p>기존 폴더를 열거나 새 작업 공간을 만드세요.</p>{action('workspace.open', '폴더 열기', false)} {action('workspace.create', '새 작업 공간', false)}</li><li><strong>문서 만들기</strong><p>새 문서 이름에 .adoc 확장자를 붙이세요.</p>{action('workspace.newDocument', '새 문서')}</li><li><strong>작성하고 저장</strong><p>원문을 작성한 뒤 저장 또는 {platformShortcut('Ctrl/Cmd+S')}를 누르세요. 미리보기는 문서를 저장하지 않습니다.</p></li><li><strong>다시 열기</strong><p>파일 목록이나 빠른 열기에서 저장한 문서를 선택하세요.</p>{action('search.files', '빠른 열기')}</li></ol><details><summary>AsciiDoc 시작 예제</summary><pre>{'= 나의 첫 문서\n\n== 오늘의 기록\n\n배운 내용을 적습니다.'}</pre><p>필요한 내용을 복사해 원문에 붙여 넣으세요.</p></details></>}
      {topic === 'writing' && <><p>원문·분할·미리보기 버튼으로 작성 방식을 선택하세요. 포함 문서는 목차의 ‘포함 원문 열기’에서 수정할 수 있습니다.</p><p>검색은 저장본 기준입니다. 검색 결과가 보이지 않으면 결과 경로와 종류 필터를 확인하세요. 문서를 오간 뒤 상단의 탐색 뒤로·앞으로로 작업 위치에 돌아갈 수 있습니다.</p><div className="tools">{action('search.text', '작업 공간 검색')}{action('layout.settings', '설정 열기', false)}</div></>}
      {topic === 'attachments' && <><p>문서 상단의 첨부파일 삽입, 파일 드롭, 이미지 붙여넣기를 사용하세요. 외부 파일은 문서 옆 assets 폴더에 복사되고 문서에는 상대 경로가 삽입됩니다.</p><p>삽입 후 문서를 저장하세요. 실행 취소는 삽입한 원문을 되돌리며 복사한 파일은 유지합니다. 문서 이동 후에는 첨부 경로를 확인하세요.</p>{action('document.attachment', '첨부파일 삽입')}</>}
      {topic === 'recovery' && <><p>‘저장하지 않은 변경’은 아직 디스크에 기록되지 않은 편집입니다. 외부 변경과 충돌하면 기준 원문·디스크·해결안을 비교하세요.</p><p>디스크 사용은 편집 내용을 교체하고, 해결안 저장은 파일에 기록합니다. 기존 편집은 복구 사본으로 보존합니다. 복구 사본에서 새 이름으로 복원하면 기존 파일을 덮어쓰지 않습니다.</p><div className="tools">{action('recovery.open', '복구 사본 열기')}{action('git.open', 'Git 이력 열기')}</div></>}
      {topic === 'review' && <><p>문서 근거 탐색과 변경 제안에서 서버·모델·전송 범위를 확인하세요. 설정만 바꾸어서는 전송하지 않습니다.</p><table><thead><tr><th>행동</th><th>결과</th></tr></thead><tbody><tr><td>전송 승인 후 실행</td><td>확인한 원문 또는 발췌를 지정한 서버로 전송</td></tr><tr><td>변경 검토 후 초안 반영</td><td>선택한 변경만 편집 버퍼에 적용</td></tr><tr><td>문서 저장</td><td>편집 내용을 디스크에 기록</td></tr></tbody></table><p>기준 문서가 바뀌면 다시 읽고 재검토해야 합니다.</p><div className="tools">{action('evidence.open', '문서 근거 탐색')}{action('proposal.open', '변경 제안 검토')}</div></>}
      {topic === 'shortcuts' && <><table><thead><tr><th>작업</th><th>단축키</th></tr></thead><tbody>{[['저장', 'Ctrl/Cmd+S'], ['빠른 열기', 'Ctrl/Cmd+P'], ['작업 공간 검색', 'Ctrl/Cmd+Shift+F'], ['명령 팔레트', 'Ctrl/Cmd+Shift+P'], ['팝업 닫기', 'Esc']].map(([label, shortcut]) => <tr key={label}><td>{label}</td><td><kbd>{platformShortcut(shortcut)}</kbd></td></tr>)}</tbody></table><p>Escape는 검색어를 지우지 않고 창을 닫습니다. 한글 조합 중에는 창을 유지합니다. 일반 작업 탭은 탭의 닫기 버튼으로 닫습니다.</p></>}
    </article></div>
  </TaskSurface>;
}

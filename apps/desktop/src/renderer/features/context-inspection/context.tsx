import { openDialog } from '../../shared/lib/accessibility';
import { EvidenceSearch } from './evidence';
import { AiSearch } from './ai';
import { ValidationResults } from './validation';
import React, { useEffect, useRef, useState } from 'react';
import type { Session, Entry, ContextBundle, SourceLocation } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import '../../shared/styles/inspector.css';
export function ContextPanel({ session, initialPath, close, open, validationOnly = false, evidenceOnly = false }: { session: Session; initialPath?: string; validationOnly?: boolean; evidenceOnly?: boolean; close(): void; open(source: SourceLocation, revision?: string): void }) {
  const title = evidenceOnly ? '문서 근거 탐색' : validationOnly ? '문서 집합 검증' : '문서 맥락 검토';
  const dialog = useRef<HTMLDialogElement>(null), serial = useRef(0), listing = useRef(0), alive = useRef(true);
  const [paths, setPaths] = useState<string[]>(initialPath ? [initialPath] : []), [roots, setRoots] = useState<string[]>(initialPath ? [initialPath] : []);
  const [folder, setFolder] = useState(''), [entries, setEntries] = useState<Entry[]>([]), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [bundle, setBundle] = useState<ContextBundle>(), [message, setMessage] = useState('사용할 파일과 해석 기준 문서를 선택하세요.');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  async function browse(relativePath: string) {
    const token = ++listing.current; setLoading(true);
    try { const result = await window.metis.listDirectory({ ...scope(), relativePath }); if (!alive.current || token !== listing.current) return;
      if (result.ok) { setFolder(relativePath); setEntries(result.value.filter(entry => !entry.name.startsWith('.'))); } else setMessage(result.error.message);
    } catch { if (alive.current && token === listing.current) setMessage('파일 목록을 읽지 못했습니다.'); }
    finally { if (alive.current && token === listing.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; const node = dialog.current!; const restoreFocus = openDialog(node); void browse('');
    return () => { alive.current = false; serial.current++; listing.current++; void window.metis.cancelContext(scope()).catch(() => {}); restoreFocus(); };
  }, []);
  function select(path: string, checked: boolean) {
    setBundle(undefined);
    if (checked) { setPaths(value => [...value, path]); if (!roots.length) setRoots([path]); }
    else { setPaths(value => value.filter(item => item !== path)); setRoots(value => value.filter(item => item !== path)); }
  }
  async function build() {
    const token = ++serial.current; setBusy(true); setBundle(undefined); setMessage(validationOnly ? '선택한 저장본을 검증하고 있습니다.' : '선택한 저장본에서 맥락을 구성하고 있습니다.');
    try { const result = await window.metis.buildContext({ ...scope(), paths, roots }); if (!alive.current || token !== serial.current) return;
      if (result.ok) { setBundle(result.value); setMessage(validationOnly ? '문서 검증을 완료했습니다. 외부 전송 없음.' : '맥락 구성을 완료했습니다. 외부 전송 없음.'); } else setMessage(result.error.message);
    } catch { if (alive.current && token === serial.current) setMessage('맥락 응답을 받지 못했습니다. 다시 구성해 주세요.'); }
    finally { if (alive.current && token === serial.current) setBusy(false); }
  }
  function cancel() { serial.current++; setBusy(false); setBundle(undefined); setMessage('맥락 구성을 취소했습니다.'); void window.metis.cancelContext(scope()).catch(() => {}); }
  const source = (where: SourceLocation) => <button onClick={() => { const revision = bundle?.sources.find(item => item.relativePath === where.relativePath)?.revision; open(where, revision); close(); }}>출처: {where.relativePath}:{where.line}</button>;
  return <dialog ref={dialog} className="recovery-dialog context-dialog" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
    <h2>{title}</h2><p>{evidenceOnly ? '맥락 구성·단어 검색은 로컬 처리 · AI 조회는 별도 전송 승인 필요' : '로컬 전용 · 외부 전송 없음'} · 저장본 기준 · 미저장 편집 제외</p>
    <p>파일을 최대 16개 선택하고, 조합의 기준이 되는 상위 문서를 최대 4개 지정하세요. 포함 파일도 직접 선택해야 합니다. 참조 대상은 자동으로 읽지 않습니다.</p>
    <fieldset disabled={busy}><legend>사용 문서 범위</legend>
      <p>폴더: /{folder}</p><div className="tools">{folder && <button disabled={loading} onClick={() => browse(folder.split('/').slice(0, -1).join('/'))}>상위 폴더</button>}<button disabled={loading} onClick={() => browse(folder)}>목록 새로 고침</button></div>
      <div className="context-files">{entries.map(entry => entry.kind === 'directory' ? <button key={entry.relativePath} disabled={loading} onClick={() => browse(entry.relativePath)}>폴더: {entry.name}</button> : <label key={entry.relativePath}><input type="checkbox" checked={paths.includes(entry.relativePath)} disabled={!paths.includes(entry.relativePath) && paths.length >= 16} onChange={event => select(entry.relativePath, event.target.checked)} />{entry.relativePath}</label>)}</div>
      <h3>선택 파일 · 해석 기준</h3>{paths.length === 0 && <p>선택한 파일이 없습니다.</p>}
      {paths.map(path => <div key={path} className="context-selection"><label><input type="checkbox" aria-label={`해석 기준: ${path}`} checked={roots.includes(path)} disabled={!roots.includes(path) && roots.length >= 4} onChange={event => { setBundle(undefined); setRoots(value => event.target.checked ? [...value, path] : value.filter(item => item !== path)); }} />{path}</label><button aria-label={`범위에서 제외: ${path}`} onClick={() => select(path, false)}>제외</button></div>)}
    </fieldset>
    <div className="tools"><button disabled={busy || !roots.length || !paths.length} onClick={build}>{validationOnly ? '문서 검증' : '맥락 구성'}</button>{busy && <button onClick={cancel}>구성 취소</button>}<button onClick={close}>닫기</button></div>
    <p role="status">{busy && <progress aria-label="맥락 구성 진행" />}{message}</p>
    {bundle && <section aria-label="검토 결과"><p>생성: {new Date(bundle.createdAt).toLocaleString()} · 자동 갱신 없음. 최신 원본은 다시 구성해 확인하세요.</p>
      <ul>{bundle.warnings.map(warning => <li key={warning}>{evidenceOnly ? '맥락 구성 단계: ' : ''}{warning}</li>)}</ul>
      {evidenceOnly && <EvidenceSearch key={bundle.createdAt} bundle={bundle} source={source} />}
      {evidenceOnly && <AiSearch key={`ai-${bundle.createdAt}`} bundle={bundle} session={session} source={source} />}
      {validationOnly && <ValidationResults report={bundle.validation} documents={bundle.documents.map(doc => doc.documentPath)} source={source} />}<h3>사용한 저장본</h3>{bundle.sources.map(item => <details key={item.relativePath}><summary>{item.relativePath} · {item.byteLength} bytes</summary><p>리비전: {item.revision}</p>{source({ relativePath: item.relativePath, line: 1 })}<pre>{item.text}</pre></details>)}
      {!validationOnly && !evidenceOnly && bundle.documents.map(doc => <section key={doc.documentPath} aria-label={`해석 맥락: ${doc.documentPath}`}><h3>해석 기준: {doc.documentPath}</h3>
        <h4>절과 출처</h4>{doc.model.outline.map((item, i) => <p key={i}>{item.title} · {source(item)}</p>)}
        <details><summary>블록 원문 · {doc.blocks.length}개</summary>{doc.blocks.map((item, i) => <article key={i}><p>{item.kind} · {item.title} · {source(item)}</p><pre>{item.text || '(본문은 선택 원문에서 확인)'}</pre></article>)}</details>
        <details><summary>속성·조건·참조·진단</summary>
          {doc.model.attributes.map((item, i) => <p key={`a${i}`}>속성 {item.name}: {item.value} · {item.applied ? '적용' : '미적용'} · {source(item)}</p>)}
          {doc.model.attributeUses.map((item, i) => <p key={`u${i}`}>사용 {item.name}: {item.value ?? '미정의'} · {source(item)}</p>)}
          {doc.model.conditions.map((item, i) => <p key={`c${i}`}>조건 {item.expression}: {{ active: '활성', inactive: '비활성', unknown: '미확인' }[item.state]} · {item.reason} · {source(item)}</p>)}
          {doc.model.relations.map((item, i) => <p key={`r${i}`}>{item.kind === 'include' ? '포함' : '참조'} {item.target}: {{ resolved: '연결됨', missing: '대상 없음', blocked: '차단됨', unchecked: '미확인' }[item.state]} · {item.message} · {source(item)}</p>)}
          {doc.model.diagnostics.map((item, i) => <p key={`d${i}`}>진단: {item.message} · {source(item)}</p>)}
        </details></section>)}
    </section>}
  </dialog>;
}

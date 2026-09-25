import { openDialog } from './accessibility';
import React, { useEffect, useRef, useState } from 'react';
import type { Session, SearchHit, SearchRequest, SearchResults } from '@metis/contracts';
import './search.css';
import { OperationStatus, type OperationPhase } from './operation-status';
const kinds = { text: '본문', file: '파일', section: '절', anchor: '앵커', attribute: '속성' };
export interface SearchMemory { query?: string; mode?: SearchRequest['mode']; caseSensitive?: boolean; path?: string; kind?: string }
export function Search({ session, initialMode, memory, close, open }: { session: Session; initialMode: SearchRequest['mode']; memory: SearchMemory; close(): void; open(hit: SearchHit): void }) {
  const [query, setQuery] = useState(memory.query ?? ''), [mode, setMode] = useState(memory.mode ?? initialMode), [caseSensitive, setCase] = useState(memory.caseSensitive ?? false), [retry, setRetry] = useState(0);
  const [pathFilter, setPathFilter] = useState(memory.path ?? ''), [kindFilter, setKindFilter] = useState(memory.kind ?? '');
  useEffect(() => { Object.assign(memory, { query, mode, caseSensitive, path: pathFilter, kind: kindFilter }); }, [query, mode, caseSensitive, pathFilter, kindFilter]);
  const [results, setResults] = useState<SearchResults>(), [status, setStatus] = useState('검색어를 입력하세요.'), [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<OperationPhase>('idle');
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0);
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); return () => restoreFocus(); }, []);
  useEffect(() => {
    const token = ++generation.current;
    setResults(undefined);
    if (!query && mode !== 'files') { setPhase('idle'); setStatus('검색어를 입력하세요.'); setRunning(false); return; }
    setPhase('running'); setRunning(true); setStatus('저장된 문서를 검색하고 있습니다.');
    const timer = setTimeout(async () => {
      if (token !== generation.current) return;
      try {
        const response = await window.metis.searchDocuments({ ...scope(), query, mode, caseSensitive });
        if (token !== generation.current) return;
        setRunning(false);
        if (!response.ok) { setPhase(response.error.code === 'CANCELLED' ? 'cancelled' : 'failed'); setStatus(response.error.message); return; }
        setPhase(response.value.partial ? 'partial' : 'complete');
        setResults(response.value);
        setStatus(response.value.partial ? '일부 범위의 검색을 완료했습니다.' : response.value.hits.length ? '검색을 완료했습니다.' : '결과가 없습니다. 검색어 또는 검색 모드를 바꿔 보세요.');
      } catch { if (token === generation.current) { setPhase('failed'); setRunning(false); setStatus('검색 연결에 실패했습니다. 다시 검색해 주세요.'); } }
    }, 250);
    return () => { generation.current++; clearTimeout(timer); void window.metis.cancelSearch(scope()).catch(() => {}); };
  }, [query, mode, caseSensitive, retry, session.workspaceId, session.workspaceEpoch]);
  function cancel() { generation.current++; setPhase('cancelled'); setRunning(false); setStatus('검색을 취소했습니다. 다시 검색할 수 있습니다.'); void window.metis.cancelSearch(scope()).catch(() => {}); }
  const hits = results?.hits.filter(hit => hit.relativePath.toLocaleLowerCase().includes(pathFilter.toLocaleLowerCase()) && (!kindFilter || hit.kind === kindFilter)) ?? [];
  return <dialog className="search-dialog" ref={dialog} aria-labelledby="search-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="search-heading"><h2 id="search-title">{mode === 'files' ? '빠른 열기' : '작업 공간 검색'}</h2><button onClick={close} aria-label="검색 닫기">닫기</button></div>
    <p>저장된 .adoc 기준 · 미저장 편집 제외 · 외부 변경은 다시 검색하면 반영됩니다.</p>
    <div className="search-controls"><label>검색 모드<select value={mode} onChange={event => setMode(event.target.value as SearchRequest['mode'])}><option value="text">본문</option><option value="files">파일 · 빠른 열기</option><option value="symbols">심볼 · 절</option></select></label>
      <label><input type="checkbox" checked={caseSensitive} onChange={event => setCase(event.target.checked)} />대소문자 구분</label></div>
    <label>검색어<input autoFocus type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'ArrowDown') { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('.search-result')?.focus(); } if (event.key === 'Enter') setRetry(value => value + 1); }} /></label>
    <div className="tools"><button onClick={() => setRetry(value => value + 1)}>다시 검색</button>{running && <button onClick={cancel}>검색 취소</button>}</div>
    <div className="search-controls"><label>결과 경로 필터<input value={pathFilter} maxLength={200} onChange={event => setPathFilter(event.target.value)} /></label><label>결과 종류<select value={kindFilter} onChange={event => setKindFilter(event.target.value)}><option value="">전체</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button onClick={() => { setPathFilter(''); setKindFilter(''); }}>필터 초기화</button></div>
    <p>필터는 받은 결과 안에서 적용됩니다. 검색어에서 아래 방향키로 결과 이동, 위·아래/Home/End로 선택, Enter로 열 수 있습니다.</p>
    <OperationStatus task="검색" phase={phase} message={status} next={phase === 'failed' || phase === 'cancelled' ? '검색어와 모드를 확인하고 다시 검색을 누르세요.' : phase === 'partial' ? '검색 범위 안내를 확인하세요. 필터는 받은 결과에만 적용됩니다.' : undefined} />
    {mode === 'symbols' && <p>각 파일을 단독 문서로 해석한 절·앵커·속성입니다. 상위 문서에서 물려받는 조건은 탐색 패널에서 확인하세요.</p>}
    {results && <><p>{results.scanned}개 문서 확인 · {results.hits.length}개 결과 · {new Date(results.completedAt).toLocaleTimeString()} 기준{results.partial ? ' · 일부 결과' : ''}</p>
      <p role="status">필터 적용: {hits.length}개 표시{!hits.length && results.hits.length ? ' · 필터를 변경하거나 초기화하세요.' : ''}</p>
      {results.warnings.length > 0 && <details><summary>검색 범위 안내</summary>{results.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      <div className="search-results" aria-label="검색 결과" onKeyDown={event => {
        if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.search-result')], index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        if (event.key === 'ArrowUp' && index === 0) { dialog.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus(); return; }
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
      }}>{hits.map((hit, index) => <button className="search-result" key={`${hit.relativePath}:${hit.kind}:${hit.line}:${index}`} onClick={() => { open(hit); close(); }}>
        <strong>{kinds[hit.kind]} · {hit.label}</strong><small>{hit.relativePath}:{hit.line}</small><span>{hit.context}</span></button>)}</div></>}
  </dialog>;
}

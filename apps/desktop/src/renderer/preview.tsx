import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { OperationStatus } from './operation-status';
import type { Analysis, OutlineEntry, Session } from '@metis/contracts';
export function safePreview(html: string): string {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio', 'img', 'link', 'meta', 'base'], FORBID_ATTR: ['style', 'src', 'srcset', 'target', 'download'] });
  const fragment = new DOMParser().parseFromString(clean, 'text/html');
  for (const anchor of fragment.querySelectorAll('a[href]')) if (!anchor.getAttribute('href')?.startsWith('#')) anchor.removeAttribute('href');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.7 system-ui;color:#233936;padding:24px;overflow-wrap:anywhere}h1,h2,h3{line-height:1.3}pre{white-space:pre-wrap;background:#eef2ed;padding:16px}table{border-collapse:collapse;max-width:100%}.tableblock{overflow-x:auto}pre{overflow-x:auto;white-space:pre}code{font-family:Consolas,monospace}.admonitionblock{margin:16px 0;padding:12px;background:#fff6df;border-left:4px solid #92691b}.admonitionblock td{border:0}td,th{border:1px solid #ccd7d2;padding:8px}a{color:#26755e}blockquote{border-left:3px solid #a3b8aa;padding-left:16px}</style></head><body>${fragment.body.innerHTML}</body></html>`;
}
export interface PreviewPosition { text?: string; html?: string; x: number; y: number; outline: number }
export function Preview({ session, relativePath, text, mode, navigate, onAnalysis, position, editorLine, reveal }: { session: Session; relativePath: string; text: string; mode: 'source' | 'split' | 'preview'; navigate(entry: OutlineEntry): void; onAnalysis(value: Analysis): void; position: PreviewPosition; editorLine(): number; reveal(): void }) {
  const [analysis, setAnalysis] = useState<Analysis>();
  const [basis, setBasis] = useState<string>();
  const current = !!analysis && basis === text;
  const outline = useRef<HTMLElement>(null), pendingId = useRef<string | undefined>(undefined);
  const restore = useRef({ x: position.x, y: position.y });
  const removeScroll = useRef<() => void>(() => {});
  useEffect(() => () => removeScroll.current(), []);
  const [status, setStatus] = useState('해석 준비 중');
  const [retry, setRetry] = useState(0);
  const [running, setRunning] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const visibleMode = useRef(mode); visibleMode.current = mode; const navigationReady = useRef(false); navigationReady.current = current && !running;
  useLayoutEffect(() => { if (mode !== 'source' && !pendingId.current) frame.current?.contentWindow?.scrollTo(position.x, position.y); }, [mode]);
  const accepted = useRef(onAnalysis); accepted.current = onAnalysis;
  const go = (source: { relativePath: string; line: number }) => { if (current && !running) navigate({ ...source, id: '', title: '', level: 1 }); };
  useEffect(() => {
    let alive = true;
    setStatus('해석 중 · 이전 미리보기는 현재 편집과 다를 수 있습니다.'); setRunning(true);
    const timer = setTimeout(async () => {
      try {
        const result = await window.metis.analyzeDocument({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath, text });
        if (!alive) return;
        setRunning(false);
        if (result.ok) {
          const unchanged = position.text === text && position.html === result.value.html;
          if (!unchanged) { position.x = 0; position.y = 0; position.outline = 0; }
          restore.current = { x: position.x, y: position.y };
          position.text = text; position.html = result.value.html;
          setBasis(text); setAnalysis(result.value); accepted.current(result.value);
          setStatus('현재 문서: 편집 내용 · 포함·참조 파일: 저장본');
        } else { setBasis(undefined); setStatus(result.error.message); }
      } catch { if (alive) { setBasis(undefined); setRunning(false); setStatus('해석에 실패했습니다. 원문 편집은 계속할 수 있습니다.'); } }
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [session.workspaceId, session.workspaceEpoch, relativePath, text, retry]);
  const srcDoc = useMemo(() => safePreview(analysis?.html ?? ''), [analysis]);
  const scrollToId = (id: string) => {
    const matches = [...(frame.current?.contentDocument?.querySelectorAll('[id]') ?? [])].filter(e => e.id === id);
    if (!id || matches.length !== 1) { setStatus('미리보기에서 유일한 절 위치를 확인하지 못했습니다. 원문과 목차를 직접 확인하세요.'); return; }
    matches[0].scrollIntoView({ block: 'start' });
  };
  useEffect(() => { if (mode !== 'source' && pendingId.current && current && !running) { const id = pendingId.current; pendingId.current = undefined; requestAnimationFrame(() => scrollToId(id)); } }, [mode, analysis, running]);
  useEffect(() => { if (analysis && outline.current) outline.current.scrollTop = position.outline; if (analysis) frame.current?.contentWindow?.scrollTo(restore.current.x, restore.current.y); }, [analysis]);
  const jump = (entry: OutlineEntry) => {
    if (!current || running) return;
    pendingId.current = entry.id;
    if (entry.relativePath === relativePath && mode !== 'preview') navigate(entry);
    if (mode === 'source') reveal(); else { pendingId.current = undefined; scrollToId(entry.id); }
  };
  const alignEditor = () => {
    if (!current || running) return;
    const line = editorLine();
    const entry = analysis?.outline.filter(e => e.relativePath === relativePath && e.line <= line).sort((a, b) => b.line - a.line)[0];
    if (!entry) { setStatus('현재 편집 줄에 대응하는 절을 확인하지 못했습니다. 목차에서 절을 선택하세요.'); return; }
    pendingId.current = entry.id;
    if (mode === 'source') reveal(); else { pendingId.current = undefined; scrollToId(entry.id); }
  };
  const loaded = () => {
    removeScroll.current(); const win = frame.current?.contentWindow; if (!win) return;
    win.scrollTo(restore.current.x, restore.current.y);
    const save = () => { if (visibleMode.current === 'source' || !navigationReady.current) return; position.x = win.scrollX; position.y = win.scrollY; };
    win.addEventListener('scroll', save, { passive: true }); removeScroll.current = () => win.removeEventListener('scroll', save);
    if (pendingId.current && mode !== 'source' && current && !running) { const id = pendingId.current; pendingId.current = undefined; scrollToId(id); }
  };
  return <div className={`analysis analysis-${mode}`}>
    <aside className="outline" ref={outline} onScroll={e => { position.outline = e.currentTarget.scrollTop; }}><h2>목차</h2><OperationStatus task="문서 해석" phase={running ? 'running' : current ? 'complete' : 'failed'} message={status} next={!running && !current ? '원문을 확인하고 미리보기 새로 고침을 누르세요. 원문 편집은 계속할 수 있습니다.' : undefined} /><button disabled={!current || running} onClick={alignEditor}>편집 위치와 맞추기</button><p>절 시작 위치로 맞춥니다. 본문 내부의 세부 위치는 동기화하지 않습니다. 원문이 바뀌면 이전 미리보기 위치를 초기화합니다.</p><button onClick={() => setRetry(value => value + 1)}>미리보기 새로 고침</button>
      {analysis?.outline.map((entry, index) => <div key={`${entry.id}-${index}`}><button className="outline-item" style={{ paddingLeft: 8 + Math.min(entry.level, 6) * 8 }} disabled={!current || running} onClick={() => jump(entry)}>{new DOMParser().parseFromString(DOMPurify.sanitize(entry.title, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }), 'text/html').body.textContent}<small>{entry.relativePath}:{entry.line}</small></button>{entry.relativePath === relativePath && <button disabled={!current || running} onClick={() => navigate(entry)}>원문 위치 열기: {entry.line}</button>}{entry.relativePath !== relativePath && <button disabled={!current || running} onClick={() => navigate(entry)}>포함 원문 열기: {entry.relativePath}</button>}</div>)}
      {analysis?.outline.length === 0 && <p>절이 없습니다.</p>}
      {analysis && <section aria-label="관계 탐색"><h3>참조 · 포함</h3>
        {analysis.relations.length === 0 && <p>해석된 관계가 없습니다.</p>}
        {analysis.relations.map((r, i) => <div key={i}><p>{r.kind === 'xref' ? '참조' : '포함'} · {r.target} · {{ resolved: '연결됨', missing: '대상 없음', blocked: '차단됨', unchecked: '미확인' }[r.state]}</p>
          <button onClick={() => go(r)}>출처: {r.relativePath}:{r.line}</button>{r.destination && <button onClick={() => go(r.destination!)}>대상 열기: {r.target}</button>}{r.message && <small>{r.message}</small>}</div>)}
      </section>}
      {!!analysis?.anchors.length && <details><summary>앵커 ({analysis.anchors.length})</summary>{analysis.anchors.map((a, i) => <button key={i} onClick={() => go(a)}>{a.id} · {a.relativePath}:{a.line}</button>)}</details>}
      {analysis && <details><summary>속성 · 조건</summary>
        <p>현재 상위 문서의 포함 조합 기준 · 참조 출처는 블록 시작 위치입니다.</p>
        {analysis.attributes.map((a, i) => <p key={`a${i}`}><button onClick={() => go(a)}>{a.name}: {a.value}</button> · {a.applied ? '적용됨' : '미적용'} · {a.relativePath}:{a.line}</p>)}
        {analysis.attributeUses.map((a, i) => <p key={`u${i}`}><button onClick={() => go(a)}>{`{${a.name}}`}</button> → {a.value ?? '정의 없음'} · {a.relativePath}:{a.line}</p>)}
        {analysis.conditions.map((c, i) => <p key={`c${i}`}><button onClick={() => go(c)}>{c.expression}</button> · {{ active: '활성', inactive: '비활성', unknown: '상세 판정 미지원' }[c.state]} · {c.reason}</p>)}
        <p>자동완성: xref:, include::, &lt;&lt;, {'{'} 뒤에서 Ctrl+Space. 후보는 최근 성공한 해석 기준이며, 다른 문서의 앵커는 현재 참조한 문서에서 제공합니다.</p>
      </details>}
      {!!analysis?.diagnostics.length && <section aria-label="해석 진단"><h3>진단</h3>{analysis.diagnostics.map((d, index) => <p key={index}>{d.relativePath}:{d.line} — {d.message}</p>)}</section>}
      <p>이미지·외부 링크는 이 미리보기에서 차단됩니다.</p>
    </aside>
    <div className="preview-surface" hidden={mode === 'source'}><p role="status">{running || !current ? '미리보기 갱신 대기 · 이전 내용일 수 있습니다.' : '현재 편집 기준 · 포함·참조 파일은 해석 시점 저장본'}</p><iframe ref={frame} onLoad={loaded} title="AsciiDoc 미리보기" sandbox="allow-same-origin" srcDoc={srcDoc} /></div>
  </div>;
}

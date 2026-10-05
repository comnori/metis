import React, { useMemo, useRef, useState } from 'react';
import { relatedDocuments } from '@metis/knowledge-index/related';
import type { RelationIndex, SourceLocation } from '@metis/contracts';
import './related.css';
export function RelatedView({ index, selected, initialMode = 'list', open }: { index?: RelationIndex; selected: string; initialMode?: 'list' | 'graph'; open(source: SourceLocation, revision?: string): void }) {
  const [mode, setMode] = useState<'list' | 'graph'>(initialMode), [focused, setFocused] = useState('');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ path: string; x: number; y: number; startX: number; startY: number } | undefined>(undefined);
  const model = useMemo(() => relatedDocuments(index?.edges ?? [], selected, 12), [index, selected]);
  const detail = model.documents.find(doc => doc.path === focused);
  const names = [selected, ...model.documents.map(doc => doc.path)].filter(Boolean);
  const position = (name: string, i: number) => {
    if (positions[name]) return positions[name];
    if (i === 0) return { x: 450, y: 250 };
    const count = Math.max(1, names.length - 1);
    const angle = (2 * Math.PI * (i - 1)) / count - Math.PI / 2;
    const radius = 170 + ((i % 2) * 35);
    const x = Math.round(450 + radius * Math.cos(angle) * 1.4);
    const y = Math.round(250 + radius * Math.sin(angle) * 0.95);
    return { x: Math.max(80, Math.min(820, x)), y: Math.max(40, Math.min(460, y)) };
  };
  const move = (name: string, x: number, y: number) => setPositions(values => ({ ...values, [name]: { x: Math.max(100, Math.min(800, x)), y: Math.max(30, Math.min(470, y)) } }));
  return <section aria-label="관련 문서"><h3>관련 문서</h3>
    <div className="tools"><button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>관련 목록</button><button aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}>관계 그래프</button><button onClick={() => setPositions({})}>그래프 배치 초기화</button></div>
    <p>직접 참조·포함과 공통 참조를 근거로 합니다. 더블 클릭하면 해당 문서를 엽니다.</p>
    {!index ? <p>새 관계 조사 결과를 기다리고 있습니다.</p> : <>
      {(model.truncated || index.partial) && <p role="note">일부 관계만 표시합니다. 관련 문서 최대 12개·문서별 근거 최대 5개입니다. 조사 범위 경고도 확인하세요.</p>}
      {!model.documents.length && <p>확인된 관련 문서가 없습니다.</p>}
      {mode === 'list' ? <ul>{model.documents.map(doc => <li key={doc.path}><button aria-pressed={focused === doc.path} onClick={() => setFocused(doc.path)}>관련 문서: {doc.path}</button></li>)}</ul> : <>
        <p>실선: 직접 참조·포함 · 점선: 같은 대상을 참조하는 간접 관계. 노드를 선택하면 근거를 표시하며 더블 클릭하면 바로 엽니다.</p>
        <div className="relation-graph" aria-label="관련 문서 그래프">
          <svg viewBox="0 0 900 500" preserveAspectRatio="none" aria-hidden="true">{model.documents.map((doc, i) => {
            const center = position(selected, 0), node = position(doc.path, i + 1);
            return <line key={doc.path} x1={center.x} y1={center.y} x2={node.x} y2={node.y} stroke="var(--secondary)" strokeWidth="2" strokeDasharray={doc.reasons.every(reason => reason.kind === 'common') ? '6 5' : undefined} />;
          })}</svg>
          {names.map((name, i) => { const point = position(name, i); return <button key={name} className="graph-node" style={{ left: `${point.x / 9}%`, top: `${point.y / 5}%` }} aria-label={`그래프 문서: ${name}`} aria-pressed={focused === name} onClick={() => setFocused(name)} onDoubleClick={() => open({ relativePath: name, line: 1 })} onKeyDown={event => {
            if (event.nativeEvent.isComposing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); move(name, point.x + (event.key === 'ArrowLeft' ? -15 : event.key === 'ArrowRight' ? 15 : 0), point.y + (event.key === 'ArrowUp' ? -15 : event.key === 'ArrowDown' ? 15 : 0));
          }} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { path: name, x: point.x, y: point.y, startX: event.clientX, startY: event.clientY }; }} onPointerMove={event => {
            const start = drag.current; if (!start || start.path !== name) return;
            const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); move(name, start.x + (event.clientX - start.startX) * 900 / bounds.width, start.y + (event.clientY - start.startY) * 500 / bounds.height);
          }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
            {i === 0 ? '중심 · ' : ''}{name}
          </button>; })}
        </div>
      </>}
      {detail && <section aria-label="관련 근거"><h4>{detail.path} · 연결 이유</h4>{detail.reasons.map((reason, i) => <article key={i}>
        <p>{reason.kind === 'common' ? `공통 참조 대상: ${reason.via}` : reason.kind === 'outgoing' ? `선택 문서에서 ${reason.edges[0].kind === 'include' ? '포함' : '참조'}` : `선택 문서를 ${reason.edges[0].kind === 'include' ? '포함' : '참조'}`}</p>
        {reason.edges.map((edge, j) => <div key={j}><button onClick={() => open({ relativePath: edge.relativePath, line: edge.revision ? edge.line : 1 }, edge.revision)}>근거 원문: {edge.relativePath}:{edge.line}</button><small> → {edge.target} · 해석 문서: {edge.documentPath}</small></div>)}
      </article>)}</section>}
    </>}
  </section>;
}

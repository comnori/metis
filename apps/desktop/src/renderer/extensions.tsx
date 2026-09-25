import { openDialog } from './accessibility';
import React, { useEffect, useRef, useState } from 'react';
import type { ExtensionDefinition, ExtensionRuntime, ExtensionViewData } from '@metis/contracts';
import './recovery.css';
export const bundledExtensions: ExtensionDefinition[] = [{
  id: 'document-summary', name: '문서 개요', description: '현재 문서의 해석된 목차·참조·진단 수를 읽어 별도 보기에 표시합니다.',
  activate(api) {
    api.view('summary', '문서 개요', async signal => {
      const model = api.readModel(); if (signal.aborted) throw Error('Cancelled');
      if (!model) return { summary: '문서를 열고 해석이 완료된 뒤 새로 고침하세요.', rows: [] };
      return { summary: `${model.path} · 참조 ${model.references}개 · 진단 ${model.diagnostics}개`, rows: model.outline.slice(0, 200).map(item => `${item.title.slice(0, 1000)} — ${item.relativePath.slice(0, 800)}:${item.line}`) };
    });
    api.command('show', '확장: 문서 개요', () => api.openView('summary'));
  }
}];
export function ExtensionsPanel({ runtime, close }: { runtime: ExtensionRuntime; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), [, render] = useState(0);
  useEffect(() => runtime.subscribe(() => render(value => value + 1)), [runtime]);
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); return () => { restoreFocus(); }; }, []);
  return <dialog ref={dialog} className="recovery-dialog" aria-label="확장 관리" onCancel={event => { event.preventDefault(); close(); }}><h2>확장 관리</h2>
    <p>앱에 포함된 확장을 관리합니다. 문서 개요는 현재 문서의 해석 결과를 읽습니다. 원문 저장·Git 실행·외부 전송 기능은 제공하지 않습니다.</p>
    {runtime.list().map(extension => <article key={extension.id}><h3>{extension.name}</h3><p>{extension.description}</p><p role="status">{{ enabled: '활성', disabled: '비활성', failed: '실패 · 중단됨', removed: '제거됨' }[extension.state]}</p>{extension.error && <p role="alert">{extension.error}</p>}
      <div className="tools">{extension.state === 'removed' ? <button onClick={() => runtime.install(extension.id)}>다시 추가</button> : <><button onClick={() => extension.state === 'enabled' ? runtime.disable(extension.id) : runtime.enable(extension.id)}>{extension.state === 'enabled' ? '비활성화' : '활성화'}</button><button onClick={() => runtime.remove(extension.id)}>제거</button></>}</div></article>)}
    <button onClick={close}>닫기</button></dialog>;
}
export function ExtensionView({ runtime, owner, id, close }: { runtime: ExtensionRuntime; owner: string; id: string; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), token = useRef(0), [data, setData] = useState<ExtensionViewData>(), [message, setMessage] = useState('읽고 있습니다.');
  const view = runtime.views().find(view => view.owner === owner && view.id === id);
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); void refresh(); return () => { token.current++; runtime.cancelViews(); restoreFocus(); }; }, []);
  async function refresh() { const serial = ++token.current; runtime.cancelViews(); setData(undefined); setMessage('읽고 있습니다.'); const result = await runtime.load(owner, id); if (serial !== token.current) return; if (result) { setData(result); setMessage('현재 해석 결과입니다. 편집 후에는 새로 고침하세요.'); } else setMessage('확장이 중단되었거나 결과를 읽지 못했습니다.'); }
  return <dialog ref={dialog} className="recovery-dialog" aria-label="확장 보기" onCancel={event => { event.preventDefault(); close(); }}><h2>{view?.title ?? '중단된 확장 보기'}</h2><p role="status">{message}</p>{data && <><p>{data.summary}</p><ul>{data.rows.map((row, i) => <li key={i}>{row}</li>)}</ul></>}<div className="tools"><button onClick={close}>닫기</button><button disabled={!view} onClick={refresh}>보기 새로 고침</button><button onClick={() => { runtime.disable(owner); close(); }}>확장 비활성화</button></div></dialog>;
}

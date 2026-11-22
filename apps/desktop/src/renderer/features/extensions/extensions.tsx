import { DialogShell } from '../../shared/ui/dialog-shell';
import React, { useEffect, useRef, useState } from 'react';
import type { ExtensionDefinition, ExtensionRuntime, ExtensionViewData } from '@metis/contracts';
import '../../shared/styles/dialog.css';
import { mermaidExtension } from './mermaid';
import { d2Extension } from './d2';
import { youtubeExtension } from './youtube';
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
}, mermaidExtension, d2Extension, youtubeExtension];
export function ExtensionsPanel({ runtime, close, children }: { runtime: ExtensionRuntime; close(): void; children?: React.ReactNode }) {
  const [, render] = useState(0), [removing, setRemoving] = useState<string>();
  useEffect(() => runtime.subscribe(() => render(value => value + 1)), [runtime]);

  return <section className="extensions-manager" aria-label="확장 관리"><h3>기본 확장</h3>
    <p>앱에 포함된 확장의 보기와 미리보기 기능을 관리합니다. 활성화·비활성화는 열린 문서에도 적용됩니다. YouTube 영상은 인터넷 연결이 필요합니다.</p>
    {runtime.list().map(extension => <article key={extension.id}><h3>{extension.name}</h3><p>{extension.description}</p><p role="status">{{ enabled: '활성', disabled: '비활성', failed: '실패 · 중단됨', removed: '제거됨' }[extension.state]}</p>{extension.error && <p role="alert">{extension.error}</p>}
      <div className="tools">{extension.state === 'removed' ? <button onClick={() => runtime.install(extension.id)}>다시 추가</button> : <><button onClick={() => extension.state === 'enabled' ? runtime.disable(extension.id) : runtime.enable(extension.id)}>{extension.state === 'enabled' ? '비활성화' : '활성화'}</button><button className="danger" onClick={() => setRemoving(extension.id)}>제거</button></>}</div></article>)}
    {removing && <div className="inline-confirmation" role="group" aria-label="확장 제거 확인"><p>{runtime.list().find(e => e.id === removing)?.name} 확장을 제거할까요? 기본 확장은 다시 추가할 수 있습니다.</p><button autoFocus onClick={() => setRemoving(undefined)}>취소</button><button className="danger" onClick={() => { runtime.remove(removing); setRemoving(undefined); }}>확장 제거</button></div>}
    {children}</section>;
}
export function ExtensionView({ runtime, owner, id, close }: { runtime: ExtensionRuntime; owner: string; id: string; close(): void }) {
  const token = useRef(0), [data, setData] = useState<ExtensionViewData>(), [message, setMessage] = useState('읽고 있습니다.');
  const view = runtime.views().find(view => view.owner === owner && view.id === id);
  useEffect(() => { void refresh(); return () => { token.current++; runtime.cancelViews(); }; }, []);
  async function refresh() { const serial = ++token.current; runtime.cancelViews(); setData(undefined); setMessage('읽고 있습니다.'); const result = await runtime.load(owner, id); if (serial !== token.current) return; if (result) { setData(result); setMessage('현재 해석 결과입니다. 편집 후에는 새로 고침하세요.'); } else setMessage('확장이 중단되었거나 결과를 읽지 못했습니다.'); }
  return <DialogShell title={view?.title ?? '중단된 확장 보기'} ariaLabel="확장 보기" close={close} auxiliary={<button onClick={() => { runtime.disable(owner); close(); }}>확장 비활성화</button>} actions={<><button onClick={close}>닫기</button><button className="primary" disabled={!view} onClick={refresh}>보기 새로 고침</button></>}><p role="status">{message}</p>{data && <><p>{data.summary}</p><ul>{data.rows.map((row, i) => <li key={i}>{row}</li>)}</ul></>}</DialogShell>;
}

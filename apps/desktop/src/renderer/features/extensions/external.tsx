import React, { useEffect, useRef, useState } from 'react';
import type { Command, PluginApi, PluginAction, PluginRecord, PluginOperation, Session } from '@metis/contracts';
import { DialogShell } from '../../shared/ui/dialog-shell';

type Panel = { title: string; mount(root: HTMLElement, signal: AbortSignal): void | (() => void) };
type Loaded = { controller: AbortController; panels: Map<string, Panel>; commands: Command[]; dispose?: () => void; style?: HTMLLinkElement };
export class ExternalPlugins {
  records: PluginRecord[] = [];
  errors = new Map<string, string>();
  loaded = new Map<string, Loaded>();
  private alive = true;
  private revision = 0;
  constructor(readonly session: Session, private host: { changed(): void; open(owner: string, id: string): void; close(): void; isDirty(path: string): boolean; filesChanged(paths: string[]): void }) {}
  async invoke(operation: PluginOperation, pluginId?: string, payload?: unknown, signal?: AbortSignal) {
    if (!this.alive) throw Error('작업 공간이 변경되었습니다.'); signal?.throwIfAborted();
    const requestId = crypto.randomUUID(), request = { requestId, workspaceId: this.session.workspaceId, workspaceEpoch: this.session.workspaceEpoch, operation, pluginId, payload };
    const abort = () => { void window.metis.plugins({ ...request, requestId: crypto.randomUUID(), operation: 'cancel', payload: { requestId } }); };
    signal?.addEventListener('abort', abort, { once: true });
    try { const result = await window.metis.plugins(request); signal?.throwIfAborted(); if (!this.alive) throw Error('작업 공간이 변경되었습니다.'); if (!result.ok) throw Error(result.error.message); return result.value; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  unload(id: string) {
    const loaded = this.loaded.get(id); if (!loaded) return;
    loaded.controller.abort(); try { loaded.dispose?.(); } catch { /* Registered resources are still revoked. */ }
    loaded.style?.remove(); this.loaded.delete(id);
  }
  async refresh() {
    const revision = ++this.revision;
    const records = await this.invoke('list') as PluginRecord[];
    if (!this.alive || revision !== this.revision) return;
    for (const id of this.loaded.keys()) if (!records.some(p => p.id === id && p.enabled && p.version === this.records.find(old => old.id === id)?.version)) this.unload(id);
    this.records = records;
    for (const record of records.filter(p => p.enabled && !this.loaded.has(p.id))) {
      const loaded: Loaded = { controller: new AbortController(), panels: new Map(), commands: [] };
      this.loaded.set(record.id, loaded); let registering = true;
      const valid = () => { if (!this.alive || loaded.controller.signal.aborted) throw Error('확장이 비활성화되었습니다.'); };
      const localId = (id: string) => { valid(); if (!registering || !/^[a-z][a-z0-9-]{0,50}$/.test(id)) throw Error('잘못된 확장 등록입니다.'); };
      const api: PluginApi = {
        sdkVersion: 1,
        command: (id, title, run) => { localId(id); const key = `plugin.${record.id}.${id}`; if (loaded.commands.some(c => c.id === key)) throw Error('중복 명령입니다.'); loaded.commands.push({ id: key, label: title, reason: () => loaded.controller.signal.aborted ? '확장이 비활성화되었습니다.' : undefined, run: async () => { try { valid(); await run(); } catch (e) { this.errors.set(record.id, e instanceof Error ? e.message : '확장 명령 실행 실패'); this.host.changed(); } } }); },
        panel: (id, title, mount) => { localId(id); if (loaded.panels.has(id)) throw Error('중복 패널입니다.'); loaded.panels.set(id, { title, mount }); },
        openPanel: id => { valid(); if (!loaded.panels.has(id)) throw Error('등록하지 않은 패널입니다.'); this.host.open(record.id, id); },
        closePanel: () => this.host.close(),
        request: async <T,>(action: PluginAction, payload?: unknown, signal?: AbortSignal) => {
          valid();
          if (action === 'write') { const p = payload as { path?: string }; if (p.path?.endsWith('.adoc') && this.host.isDirty(p.path)) throw Error('저장하지 않은 편집이 있습니다. 문서를 저장하거나 새 사본을 선택하세요.'); }
          const result = await this.invoke('call', record.id, { action, payload }, signal ? AbortSignal.any([signal, loaded.controller.signal]) : loaded.controller.signal);
          valid(); return result as T;
        },
        isDirty: relativePath => this.host.isDirty(relativePath), filesChanged: paths => { valid(); this.host.filesChanged(paths); }
      };
      try {
        const module = await import(/* @vite-ignore */ `${record.entryUrl}?v=${record.version}&load=${crypto.randomUUID()}`);
        valid(); if (revision !== this.revision) { this.unload(record.id); return; }
        if (typeof module.activate !== 'function') throw Error('ESM activate(api) 함수가 필요합니다.');
        if (record.styleUrl) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = record.styleUrl + `?v=${record.version}`; document.head.append(style); loaded.style = style; }
        const dispose = module.activate(api); if (dispose !== undefined && typeof dispose !== 'function') throw Error('activate는 동기 해제 함수를 반환해야 합니다.'); loaded.dispose = dispose; this.errors.delete(record.id);
      } catch (e) { this.errors.set(record.id, e instanceof Error ? e.message : '확장 실행 실패'); this.unload(record.id); }
      finally { registering = false; }
    }
    this.host.changed();
  }
  commands() { return [...this.loaded.values()].flatMap(p => p.commands); }
  dispose() { this.alive = false; this.revision++; for (const id of this.loaded.keys()) this.unload(id); }
}
export function ExternalPluginManager({ runtime, onBusy }: { runtime?: ExternalPlugins; onBusy?(value: boolean): void }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [repository, setRepository] = useState(''), [removing, setRemoving] = useState<string>();
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  async function change(operation: PluginOperation, id?: string, payload?: unknown) {
    if (!runtime) return; setBusy(true); setMessage('처리 중…');
    try { if (id) runtime.unload(id); await runtime.invoke(operation, id, payload); await runtime.refresh(); setMessage('확장 목록을 갱신했습니다.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : '확장 작업 실패'); await runtime.refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section aria-label="외부 확장"><h3>설치한 확장</h3><p>신뢰하는 확장만 설치하세요. 확장은 앱 화면과 작업 공간 파일에 접근할 수 있습니다.</p>
    {!runtime ? <p>확장을 설치할 작업 공간을 먼저 여세요.</p> : <>
      <div className="tools"><button disabled={busy} onClick={() => change('install', undefined, { kind: 'folder' })}>폴더 설치</button><button disabled={busy} onClick={() => change('install', undefined, { kind: 'zip' })}>ZIP 설치</button></div>
      <label>GitHub 저장소 <input value={repository} placeholder="owner/repository" onChange={e => setRepository(e.target.value)} /></label><button disabled={busy || !repository.trim()} onClick={() => change('github', undefined, { repository })}>GitHub 설치</button>
      {runtime.records.map(record => <article key={record.id}><h4>{record.name} · {record.version}</h4><p>{record.description}</p><p>{record.error ?? runtime.errors.get(record.id)}</p><div className="tools">
        <button disabled={busy || !!record.error} onClick={() => change('enable', record.id, { enabled: !record.enabled })}>{record.enabled ? '비활성화' : '활성화'}</button>
        {runtime.loaded.get(record.id)?.commands.map(command => <button disabled={busy} key={command.id} onClick={() => command.run()}>{command.label}</button>)}
        <button disabled={busy} onClick={() => change('install', record.id, { kind: 'zip' })}>ZIP 업데이트</button>
        {record.source && <button disabled={busy} onClick={() => change('github', record.id, { repository: record.source })}>GitHub 업데이트</button>}
        <button className="danger" disabled={busy} onClick={() => setRemoving(record.id)}>제거</button>
      </div></article>)}
    </>}{removing && <div className="inline-confirmation" role="group" aria-label="외부 확장 제거 확인"><p>{runtime?.records.find(record => record.id === removing)?.name} 확장을 제거할까요? 확장 연결과 실행 중인 화면도 종료됩니다.</p><button autoFocus disabled={busy} onClick={() => setRemoving(undefined)}>취소</button><button className="danger" disabled={busy} onClick={() => { void change('remove', removing); setRemoving(undefined); }}>확장 제거</button></div>}<p role="status">{message}</p></section>;
}
export function ExternalPluginPanel({ runtime, owner, id, close }: { runtime: ExternalPlugins; owner: string; id: string; close(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const loaded = runtime.loaded.get(owner), panel = loaded?.panels.get(id);
  useEffect(() => {
    if (!panel || !loaded) { close(); return; }
    const controller = new AbortController();
    let dispose: void | (() => void);
    const stop = () => close(); loaded.controller.signal.addEventListener('abort', stop, { once: true });
    try { dispose = panel.mount(root.current!, AbortSignal.any([controller.signal, loaded.controller.signal])); }
    catch (e) { root.current!.textContent = e instanceof Error ? e.message : '확장 화면 실행 실패'; }
    return () => { controller.abort(); loaded.controller.signal.removeEventListener('abort', stop); dispose?.(); };
  }, [runtime, owner, id]);
  return <DialogShell title={panel?.title ?? '확장'} close={close}><div ref={root} /></DialogShell>;
}

import type { Command } from './commands';
export interface ExtensionModel { path: string; outline: Array<{ title: string; line: number; relativePath: string }>; references: number; diagnostics: number }
export interface ExtensionViewData { summary: string; rows: string[] }
export interface ExtensionApi {
  readModel(): ExtensionModel | undefined;
  command(id: string, label: string, run: () => void): void;
  view(id: string, title: string, load: (signal: AbortSignal) => Promise<ExtensionViewData>): void;
  openView(id: string): void;
}
export interface ExtensionDefinition { id: string; name: string; description: string; activate(api: ExtensionApi): void | (() => void) }
export type ExtensionState = 'disabled' | 'enabled' | 'failed' | 'removed';
interface Entry { definition: ExtensionDefinition; state: ExtensionState; epoch: number; cleanup?: () => void; error?: string; commands: Command[]; views: Map<string, { title: string; load(signal: AbortSignal): Promise<ExtensionViewData> }>; pending: Set<AbortController> }
export class ExtensionRuntime {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  constructor(definitions: ExtensionDefinition[], private host: { readModel(): ExtensionModel | undefined; openView(owner: string, id: string): void }) {
    for (const definition of definitions) {
      if (!/^[a-z][a-z0-9-]{0,50}$/.test(definition.id) || this.entries.has(definition.id)) throw Error('Invalid extension ID');
      this.entries.set(definition.id, { definition, state: 'disabled', epoch: 0, commands: [], views: new Map(), pending: new Set() });
    }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }
  list() { return [...this.entries.values()].map(e => ({ id: e.definition.id, name: e.definition.name, description: e.definition.description, state: e.state, error: e.error })); }
  commands(): Command[] { return [...this.entries.values()].flatMap(e => e.state === 'enabled' ? e.commands : []); }
  views() { return [...this.entries.values()].flatMap(e => e.state === 'enabled' ? [...e.views].map(([id, view]) => ({ owner: e.definition.id, id, title: view.title })) : []); }
  private entry(id: string) { const entry = this.entries.get(id); if (!entry) throw Error('Unknown extension'); return entry; }
  private stop(entry: Entry, state: ExtensionState) {
    entry.epoch++; entry.state = state;
    for (const controller of entry.pending) controller.abort(); entry.pending.clear();
    entry.commands = []; entry.views.clear();
    const cleanup = entry.cleanup; entry.cleanup = undefined;
    try { cleanup?.(); } catch { entry.error = '확장 정리를 완료하지 못했습니다. 등록된 명령과 보기는 해제했습니다.'; }
  }
  disable(id: string) { const e = this.entry(id); this.stop(e, 'disabled'); this.notify(); }
  remove(id: string) { const e = this.entry(id); this.stop(e, 'removed'); this.notify(); }
  install(id: string) { const e = this.entry(id); if (e.state === 'removed') { e.state = 'disabled'; e.error = undefined; this.notify(); } }
  private fail(entry: Entry) { this.stop(entry, 'failed'); entry.error = '확장 실행에 실패하여 명령과 보기를 중단했습니다. 기본 편집은 계속 사용할 수 있습니다.'; this.notify(); }
  enable(id: string) {
    const entry = this.entry(id); if (entry.state === 'enabled' || entry.state === 'removed') return;
    this.stop(entry, 'enabled'); entry.error = undefined; const epoch = entry.epoch; let registering = true;
    const valid = () => entry.state === 'enabled' && entry.epoch === epoch;
    const check = () => { if (!valid()) throw Error('Revoked extension'); };
    const localId = (id: string) => { if (!registering) throw Error('Registration closed'); if (!/^[a-z][a-z0-9-]{0,50}$/.test(id)) throw Error('Invalid contribution ID'); };
    try {
      const cleanup = entry.definition.activate({
        readModel: () => { check(); const model = this.host.readModel(); return model ? structuredClone(model) : undefined; },
        command: (id, label, run) => { check(); localId(id); const key = `extension.${entry.definition.id}.${id}`; if (entry.commands.some(c => c.id === key) || !label || label.length > 120) throw Error('Invalid command'); entry.commands.push({ id: key, label, reason: () => valid() ? undefined : '확장이 비활성화되었습니다.', run: () => { check(); try { const result: unknown = run(); if (result && typeof (result as Promise<unknown>).then === 'function') { Promise.resolve(result).catch(() => {}); throw Error('Commands must be synchronous'); } } catch { if (valid()) this.fail(entry); } } }); },
        view: (id, title, load) => { check(); localId(id); if (entry.views.has(id) || !title || title.length > 120) throw Error('Invalid view'); entry.views.set(id, { title, load }); },
        openView: id => { check(); if (!entry.views.has(id)) throw Error('Unknown view'); this.host.openView(entry.definition.id, id); }
      });
      if (cleanup !== undefined && typeof cleanup !== 'function') throw Error('Invalid cleanup');
      entry.cleanup = cleanup || undefined;
    } catch { this.fail(entry); return; } finally { registering = false; }
    this.notify();
  }
  async load(owner: string, id: string): Promise<ExtensionViewData | undefined> {
    const entry = this.entry(owner), view = entry.views.get(id), epoch = entry.epoch;
    if (entry.state !== 'enabled' || !view) return;
    const controller = new AbortController(); entry.pending.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw Error('Cancelled'); return view.load(controller.signal); }), new Promise<never>((_, reject) => { controller.signal.addEventListener('abort', () => reject(Error('Cancelled')), { once: true }); timer = setTimeout(() => reject(Error('Timeout')), 5000); })]);
      if (controller.signal.aborted || entry.epoch !== epoch || entry.state !== 'enabled') return;
      if (!result || typeof result.summary !== 'string' || result.summary.length > 2000 || !Array.isArray(result.rows) || result.rows.length > 200 || result.rows.some(row => typeof row !== 'string' || row.length > 2000)) throw Error('Invalid view data');
      return structuredClone(result);
    } catch { if (!controller.signal.aborted && entry.epoch === epoch && entry.state === 'enabled') this.fail(entry); }
    finally { clearTimeout(timer); controller.abort(); entry.pending.delete(controller); }
  }
  cancelViews() { for (const entry of this.entries.values()) { for (const controller of entry.pending) controller.abort(); entry.pending.clear(); } }
  dispose() { for (const entry of this.entries.values()) this.stop(entry, 'disabled'); this.listeners.clear(); }
}

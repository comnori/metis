import { GettingStarted } from '../features/getting-started';
import { ViewSettings } from '../features/view-settings';
import { useAppearance, useLayout } from '../shared/model';
import { ProposalPanel } from '../features/proposal';
import { SemanticPanel } from '../features/semantic-diff';
import { ContextPanel } from '../features/context-inspection';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Documents, type DocumentsHandle, type DocumentTabSnapshot } from '../widgets/document-workspace';
import { Search, type SearchMemory } from '../features/search';
import { RecoveryPanel } from '../features/recovery';
import { FileChange } from '../features/file-change';
import { Relations } from '../features/relations';
import { GitPanel } from '../features/git';
import { CommandPalette } from '../features/command-palette';
import { ExtensionsPanel, ExtensionView, bundledExtensions } from '../features/extensions';
import { ExtensionRuntime } from '@metis/contracts';
import { executeCommand, type Command } from '@metis/contracts';
import type { SearchRequest } from '@metis/contracts';
import '../widgets/document-workspace/documents.css';
import '../widgets/document-workspace/preview.css';
import { validFolderName, type Analysis, type Api, type Session, type Entry, type DocumentSnapshot, type Result, type RecentWorkspace, type PreviewStylesheet } from '@metis/contracts';
import './styles/style.css';
import './styles/workspace.css';
import './styles/layout.css';
import './styles/accessibility.css';
declare global { interface Window { metis: Api } }
const requestId = () => crypto.randomUUID();
const scope = (s: Session) => ({ requestId: requestId(), workspaceId: s.workspaceId, workspaceEpoch: s.workspaceEpoch });
function SidebarIcon({ name }: { name: 'up' | 'refresh' | 'folder' | 'document' }) {
  return <svg className="sidebar-action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'up' && <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>}
    {name === 'refresh' && <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 11" /><path d="m4 13 2.3 4.6A7 7 0 0 0 18 15" /></>}
    {name === 'folder' && <><path d="M3 7.5h6l2-2h3.5" /><path d="M3 7.5h18v11H3z" /><path d="M15 10.5v5" /><path d="M12.5 13h5" /></>}
    {name === 'document' && <><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /><path d="M12 11v6" /><path d="M9 14h6" /></>}
  </svg>;
}
function RibbonIcon({ name }: { name: 'files' | 'search' | 'favorites' | 'graph' | 'inspector' | 'command' | 'help' | 'settings' | 'tools' }) {
  const glyph = { files: '▤', search: '⌕', favorites: '☆', graph: '◎', inspector: '≡', command: '⌘', help: '?', settings: '⚙', tools: '⋯' }[name];
  return <span className="ribbon-glyph" aria-hidden="true">{glyph}</span>;
}
function PanelResizer({ side, value, min, max, resize }: { side: 'left' | 'right'; value: number; min: number; max: number; resize(value: number): void }) {
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const direction = side === 'left' ? 1 : -1;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max : event.key === 'ArrowLeft' ? value - 10 * direction : event.key === 'ArrowRight' ? value + 10 * direction : undefined;
    if (next !== undefined) { event.preventDefault(); resize(next); }
  }
  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId); const start = event.clientX, width = value;
    const move = (next: PointerEvent) => resize(width + (next.clientX - start) * (side === 'left' ? 1 : -1));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  return <div className={`panel-resizer ${side}`} role="separator" tabIndex={0} aria-label={`${side === 'left' ? '왼쪽' : '오른쪽'} 사이드바 너비 조절`} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} onKeyDown={keyDown} onPointerDown={pointerDown} />;
}
async function call<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try { return await work(); }
  catch { return { ok: false, requestId: 'connection', error: { code: 'INTERNAL_ERROR', message: '앱 연결을 확인한 뒤 다시 시도해 주세요.', retryable: true } }; }
}
function App() {
  const documents = useRef<DocumentsHandle>(null);
  const [inspectorTarget, setInspectorTarget] = useState<HTMLDivElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hideHints, setHideHints] = useState(() => { try { return localStorage.getItem('metis.welcome.hidden.v1') === 'true'; } catch { return false; } });
  function setHintsHidden(hidden: boolean) { setHideHints(hidden); try { localStorage.setItem('metis.welcome.hidden.v1', String(hidden)); } catch { setStatus('안내 표시 설정을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); } }
  const [session, setSession] = useState<Session>();
  const layout = useLayout(session?.viewKey);
  const appearance = useAppearance(session?.viewKey);
  useEffect(() => {
    window.document.documentElement.setAttribute('data-theme', appearance.value.previewTheme);
  }, [appearance.value.previewTheme]);
  const [stylesheet, setStylesheet] = useState<PreviewStylesheet>({ active: false });
  const [stylesheetVersion, setStylesheetVersion] = useState(0);
  const menu = useRef<HTMLDetailsElement>(null), filesButton = useRef<HTMLButtonElement>(null), outlineButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key !== 'Escape' || window.document.querySelector('dialog[open]')) return; if (menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } else if (layout.mobile) { (layout.mobile === 'left' ? filesButton : outlineButton).current?.focus(); layout.setMobile(undefined); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [layout.mobile]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tree, setTree] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [document, setDocument] = useState<DocumentSnapshot>();
  const [documentTabs, setDocumentTabs] = useState<DocumentTabSnapshot[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<Analysis>();
  const [centerView, setCenterView] = useState<'documents' | 'graph'>('documents');
  const [graphOpen, setGraphOpen] = useState(false);
  const [editorStats, setEditorStats] = useState<{ line: number; col: number; words: number; chars: number }>();
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; path: string; isGraph?: boolean } | null>(null);
  useEffect(() => {
    if (!tabContextMenu) return;
    const dismiss = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      setTabContextMenu(null);
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [tabContextMenu]);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [status, setStatus] = useState('폴더를 열어 시작하세요.');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [recentWarning, setRecentWarning] = useState('');
  const [creating, setCreating] = useState<'workspace' | 'directory' | 'document'>();
  const createDialog = useRef<HTMLDialogElement>(null);
  const createInvoker = useRef<HTMLElement | null>(null);
  useEffect(() => { const node = createDialog.current; if (creating && node) { node.showModal(); return () => { node.close(); createInvoker.current?.focus(); }; } }, [creating]);
  const [name, setName] = useState('');
  const [searchMode, setSearchMode] = useState<SearchRequest['mode']>();
  const searchMemory = useRef<Record<string, SearchMemory>>({});
  useEffect(() => { searchMemory.current = {}; }, [session?.workspaceId, session?.workspaceEpoch]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState<false | 'list' | 'graph'>(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [changingFile, setChangingFile] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extensionView, setExtensionView] = useState<{ owner: string; id: string }>();
  const [extensions] = useState(() => new ExtensionRuntime(bundledExtensions, { readModel: () => documents.current?.extensionModel(), openView: (owner, id) => setExtensionView({ owner, id }) }));
  const [, updateCommands] = useState(0);
  const currentCommands = useRef<Command[]>([]), commandRunning = useRef(false);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem('metis.extensions.v1') ?? '{}'); for (const item of extensions.list()) { if (saved[item.id] === 'enabled') extensions.enable(item.id); else if (saved[item.id] === 'removed') extensions.remove(item.id); } } catch { /* Invalid preferences leave bundled extensions disabled. */ }
    updateCommands(value => value + 1);
    const unsubscribe = extensions.subscribe(() => {
      updateCommands(value => value + 1);
      const failed = extensions.list().find(item => item.state === 'failed'); if (failed) setStatus(`${failed.name}: 확장이 중단되었습니다. 확장 관리에서 확인하세요.`);
      setExtensionView(view => view && extensions.views().some(item => item.owner === view.owner && item.id === view.id) ? view : undefined);
      try { localStorage.setItem('metis.extensions.v1', JSON.stringify(Object.fromEntries(extensions.list().map(item => [item.id, item.state])))); } catch { setWarning('확장 상태를 저장하지 못했습니다. 다음 실행에는 기본 상태를 사용합니다.'); }
    });
    return () => { unsubscribe(); extensions.dispose(); };
  }, [extensions]);
  useEffect(() => { extensions.cancelViews(); setExtensionView(undefined); }, [session?.workspaceId, session?.workspaceEpoch, extensions]);
  useEffect(() => {
    let alive = true;
    if (!session) { setStylesheet({ active: false }); return; }
    void call(() => window.metis.readPreviewStylesheet(scope(session))).then(result => {
      if (!alive) return;
      if (result.ok) { setStylesheet(result.value); if (result.value.warning) setWarning(result.value.warning); }
      else setWarning(result.error.message);
    });
    return () => { alive = false; };
  }, [session?.workspaceId, session?.workspaceEpoch]);
  const favoriteKey = session ? `metis.favorites.v1.${session.viewKey ?? session.workspaceId}` : '';
  useEffect(() => {
    if (!favoriteKey) { setFavorites([]); return; }
    try { const value = JSON.parse(localStorage.getItem(favoriteKey) ?? '[]'); setFavorites(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []); }
    catch { setFavorites([]); setWarning('즐겨찾기 목록을 읽지 못했습니다.'); }
  }, [favoriteKey]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || window.document.querySelector('dialog[open]') || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'p' && event.shiftKey) { event.preventDefault(); if (!locked.current) setPaletteOpen(true); return; }
      const id = (key === 'p' || key === 'o') && !event.shiftKey ? 'search.files' : key === 'f' && event.shiftKey ? 'search.text' : key === 's' && !event.shiftKey ? 'document.save' : undefined;
      if (id) { event.preventDefault(); void dispatch(id); }
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const generation = useRef(0), listing = useRef(0), reading = useRef(0), recentRequest = useRef(0), locked = useRef(false);
  const launchHandler = useRef<() => Promise<void>>(async () => {}), launchPolling = useRef(false);
  launchHandler.current = async () => {
    if (launchPolling.current || locked.current || commandRunning.current || window.document.querySelector('dialog[open]')) return;
    launchPolling.current = true; let processing = false;
    try {
      const pending = await window.metis.pendingLaunch({ requestId: requestId() }); if (!pending.ok || !pending.value) return;
      if (locked.current || commandRunning.current || window.document.querySelector('dialog[open]')) return;
      locked.current = true; processing = true;
      const item = pending.value;
      if (item.error) { setError(item.error); await window.metis.dismissLaunch({ requestId: requestId(), launchId: item.id }); return; }
      setBusy(true);
      if (!item.sameWorkspace && !(await documents.current?.allowLeave())) { await window.metis.dismissLaunch({ requestId: requestId(), launchId: item.id }); setStatus('CLI 열기를 취소했습니다. 기존 편집은 유지됩니다.'); return; }
      const result = await window.metis.applyLaunch({ requestId: requestId(), launchId: item.id }); if (!result.ok) { report(result); return; }
      const target = result.value, changed = session?.workspaceId !== target.session.workspaceId || session?.workspaceEpoch !== target.session.workspaceEpoch;
      if (changed) { generation.current++; reading.current++; documents.current?.clear(); setTree({}); setExpanded(new Set()); setGraphOpen(false); setCenterView('documents'); setActiveAnalysis(undefined); setSession(target.session); setWarning(target.session.warning ?? ''); await list(target.session, ''); }
      if (changed) await loadRecents();
      if (target.relativePath) {
        const content = await window.metis.readDocument({ ...scope(target.session), relativePath: target.relativePath });
        if (!content.ok) { report(content); return; }
        const edited = documents.current?.isDirty(target.relativePath);
        const token = ++reading.current, epoch = generation.current;
        requestAnimationFrame(() => { if (token === reading.current && epoch === generation.current) documents.current?.open(content.value, edited ? undefined : target.line); });
        setStatus(edited ? 'CLI 요청 문서의 미저장 편집을 유지했습니다. 저장본 줄 위치로 이동하지 않았습니다.' : 'CLI 요청의 문서 위치를 열었습니다.');
      }
    } catch { setError('CLI 요청을 처리하지 못했습니다.'); }
    finally { launchPolling.current = false; if (processing) { locked.current = false; setBusy(false); } }
  };
  useEffect(() => { const timer = setInterval(() => { void launchHandler.current(); }, 800); void launchHandler.current(); return () => clearInterval(timer); }, []);
  function report<T>(result: Result<T>) {
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') setError(result.error.message);
      setStatus(result.error.code === 'CANCELLED' ? '폴더 선택을 취소했습니다.' : '요청을 완료하지 못했습니다.');
    }
  }
  async function loadRecents() {
    const token = ++recentRequest.current;
    const result = await call(() => window.metis.recentWorkspaces({ requestId: requestId() }));
    if (token !== recentRequest.current) return;
    if (result.ok) { setRecent(result.value.entries); setRecentWarning(result.value.warning ?? ''); }
    else setRecentWarning(result.error.message);
  }
  useEffect(() => { void loadRecents(); }, []);
  useEffect(() => {
    void (async () => {
      const result = await call(() => window.metis.startupWorkspace({ requestId: requestId() }));
      if (!result.ok) { setWarning(`마지막 작업 공간을 자동으로 열지 못했습니다: ${result.error.message}`); return; }
      if (!result.value) return;
      generation.current++; reading.current++;
      setSession(result.value); setWarning(result.value.warning ?? '');
      await list(result.value, '');
      setStatus('마지막 작업 공간을 다시 열었습니다.');
    })();
  }, []);
  async function list(s: Session, relativePath: string, epoch = generation.current) {
    const token = ++listing.current;
    setLoading(true); setError('');
    const result = await call(() => window.metis.listDirectory({ ...scope(s), relativePath }));
    if (epoch !== generation.current || token !== listing.current) return;
    setLoading(false);
    if (result.ok) { setEntries(result.value); setTree(value => ({ ...value, [relativePath]: result.value })); setFolder(relativePath); setStatus('폴더를 열었습니다.'); } else report(result);
  }
  async function toggleDirectory(entry: Entry) {
    if (!session || entry.kind !== 'directory') return;
    const open = !expanded.has(entry.relativePath);
    setExpanded(value => { const next = new Set(value); if (open) next.add(entry.relativePath); else next.delete(entry.relativePath); return next; });
    if (open && !tree[entry.relativePath]) await list(session, entry.relativePath);
    else if (open) setFolder(entry.relativePath);
    else if (folder === entry.relativePath || folder.startsWith(`${entry.relativePath}/`)) { const parent = entry.relativePath.split('/').slice(0, -1).join('/'); setFolder(parent); setEntries(tree[parent] ?? []); }
  }
  function updateFavorites(next: string[]) {
    const unique = [...new Set(next)].sort(); setFavorites(unique);
    if (!favoriteKey) return;
    try { localStorage.setItem(favoriteKey, JSON.stringify(unique)); }
    catch { setWarning('즐겨찾기 변경을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); }
  }
  function toggleFavorite(path: string) {
    const starred = favorites.includes(path); updateFavorites(starred ? favorites.filter(item => item !== path) : [...favorites, path]);
    setStatus(starred ? `${path}: 즐겨찾기에서 제거했습니다.` : `${path}: 즐겨찾기에 추가했습니다.`);
  }
  function treeRows(parent = '', depth = 0): React.ReactNode {
    return (tree[parent] ?? (parent === folder ? entries : [])).map(entry => <React.Fragment key={entry.relativePath}><div className={`file-row ${document?.relativePath === entry.relativePath ? 'active' : ''}`} style={{ '--tree-depth': depth } as React.CSSProperties}>
      <button className="file-entry" aria-label={`${entry.kind === 'directory' ? (expanded.has(entry.relativePath) ? '▾' : '▸') : '≡'}${entry.name}`} disabled={busy || loading} onClick={() => entry.kind === 'directory' ? void toggleDirectory(entry) : void read(entry).then(() => { layout.setMobile(undefined); filesButton.current?.focus(); })}><span className="file-icon" aria-hidden="true">{entry.kind === 'directory' ? (expanded.has(entry.relativePath) ? '▾' : '▸') : '≡'}</span><span>{entry.name}</span></button>
      {entry.kind === 'document' && <><button className={`file-star ${favorites.includes(entry.relativePath) ? 'starred' : ''}`} aria-label={`${entry.name} ${favorites.includes(entry.relativePath) ? '즐겨찾기 제거' : '즐겨찾기 추가'}`} aria-pressed={favorites.includes(entry.relativePath)} onClick={() => toggleFavorite(entry.relativePath)}>{favorites.includes(entry.relativePath) ? '★' : '☆'}</button><button className="file-more" disabled={busy || loading || session?.readOnly} aria-label={`${entry.name} 파일 변경`} onClick={() => setChangingFile(entry.relativePath)}>⋯</button></>}
    </div>{entry.kind === 'directory' && expanded.has(entry.relativePath) && treeRows(entry.relativePath, depth + 1)}</React.Fragment>);
  }
  async function changeWorkspace(work: () => Promise<Result<Session>>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (!(await documents.current?.allowLeave())) return;
      const result = await call(work);
      if (!result.ok) { report(result); return; }
      generation.current++; reading.current++;
      setSession(result.value); setWarning(result.value.warning ?? ''); setCreating(undefined); setGraphOpen(false); setCenterView('documents'); setActiveAnalysis(undefined);
      documents.current?.clear(); setEntries([]); setTree({}); setExpanded(new Set()); setFolder('');
      await list(result.value, '');
    } finally { await loadRecents(); locked.current = false; setBusy(false); }
  }
  const open = () => changeWorkspace(() => window.metis.openWorkspace({ requestId: requestId() }));
  function beginCreate(kind: 'workspace' | 'directory' | 'document') { createInvoker.current = window.document.activeElement as HTMLElement; setName(kind === 'document' ? 'untitled.adoc' : ''); setError(''); setCreating(kind); }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    let finalName = name.trim();
    if (creating === 'document' && !/\.adoc$/i.test(finalName)) {
      finalName = `${finalName}.adoc`;
    }
    if (!validFolderName(finalName) || locked.current) return;
    if (creating === 'workspace') return changeWorkspace(() => window.metis.createWorkspace({ requestId: requestId(), name: finalName }));
    if (!session) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (creating === 'document') {
        const result = await call(() => window.metis.createDocument({ ...scope(session), relativePath: folder, name: finalName }));
        if (result.ok) { setCreating(undefined); await list(session, folder); documents.current?.open(result.value); setStatus('문서를 만들었습니다.'); } else report(result);
      } else {
        const result = await call(() => window.metis.createDirectory({ ...scope(session), relativePath: folder, name: finalName }));
        if (result.ok) { setCreating(undefined); await list(session, folder); setStatus('폴더를 만들었습니다.'); } else report(result);
      }
    } finally { locked.current = false; setBusy(false); }
  }
  async function read(entry: Entry, line?: number, revision?: string) {
    if (!session) return;
    setError(''); setStatus('문서를 읽고 있습니다.');
    const token = ++reading.current, epoch = generation.current;
    const result = await call(() => window.metis.readDocument({ ...scope(session), relativePath: entry.relativePath }));
    if (token !== reading.current || epoch !== generation.current) return;
    if (result.ok) {
      const changed = revision && revision !== result.value.revision;
      const edited = revision && documents.current?.isDirty(entry.relativePath);
      documents.current?.open(result.value, changed || edited ? undefined : line);
      setCenterView('documents');
      setStatus(changed ? '검색 이후 원본이 변경되었습니다. 다시 검색해 주세요. 이전 줄 번호로 이동하지 않았습니다.' : edited ? '미저장 편집을 유지했습니다. 저장본 검색 위치와 다를 수 있어 이동하지 않았습니다.' : '원문을 열었습니다.');
    } else report(result);
  }
  async function close() {
    if (!session || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      if (!(await documents.current?.allowLeave())) return;
      const result = await call(() => window.metis.closeWorkspace(scope(session)));
      if (!result.ok) return report(result);
      generation.current++; setLoading(false); setSession(undefined); setEntries([]); setTree({}); setExpanded(new Set()); documents.current?.clear(); setGraphOpen(false); setCenterView('documents'); setActiveAnalysis(undefined);
      setFolder(''); setError(''); setWarning(''); setStatus('폴더를 닫았습니다.'); await loadRecents();
    } finally { locked.current = false; setBusy(false); }
  }
  async function removeRecent(id: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await call(() => window.metis.removeRecentWorkspace({ requestId: requestId(), recentId: id }));
      if (!result.ok) report(result); else { await loadRecents(); setStatus('최근 목록에서 제거했습니다. 폴더는 유지됩니다.'); }
    } finally { locked.current = false; setBusy(false); }
  }
  async function reloadStylesheet() {
    if (!session) return;
    const result = await call(() => window.metis.readPreviewStylesheet(scope(session)));
    if (!result.ok) return report(result);
    setStylesheet(result.value); setStylesheetVersion(value => value + 1);
    setStatus(result.value.warning ?? (result.value.active ? '사용자 CSS를 다시 읽었습니다.' : '연결된 사용자 CSS가 없습니다.'));
  }
  async function selectStylesheet() {
    if (!session) return;
    const result = await call(() => window.metis.selectPreviewStylesheet(scope(session)));
    if (!result.ok) return report(result);
    setStylesheet(result.value); setStylesheetVersion(value => value + 1);
    appearance.update({ ...appearance.value, customCssEnabled: result.value.active });
    setStatus(result.value.warning ?? '사용자 CSS를 연결했습니다.');
  }
  async function clearStylesheet() {
    if (!session) return;
    const result = await call(() => window.metis.clearPreviewStylesheet(scope(session)));
    if (!result.ok) return report(result);
    setStylesheet(result.value); setStylesheetVersion(value => value + 1);
    appearance.update({ ...appearance.value, customCssEnabled: false });
    setStatus('사용자 CSS 연결을 해제했습니다.');
  }
  const blocked = () => locked.current || commandRunning.current ? '진행 중인 작업을 완료하세요.' : settingsOpen || creating || searchMode === 'files' || recoveryOpen || relationsOpen || gitOpen || changingFile || extensionsOpen || extensionView ? '열린 대화상자를 먼저 닫으세요.' : undefined;
  const needsWorkspace = () => blocked() ?? (!session ? '먼저 작업 공간을 여세요.' : undefined);
  const folderReady = () => needsWorkspace() ?? (loading ? '폴더 목록을 읽고 있습니다.' : undefined);
  const writable = () => folderReady() ?? (session?.readOnly ? '읽기 전용 작업 공간입니다.' : undefined);
  const commands: Command[] = [
    { id: 'layout.settings', label: '보기 설정', reason: blocked, run: () => setSettingsOpen(true) },
    { id: 'help.start', label: '시작 안내', reason: blocked, run: () => setHelpOpen(true) },
    { id: 'external.configure', label: '외부 편집기 설정', reason: blocked, run: async () => { const result = await call(() => window.metis.configureEditor({ requestId: requestId() })); if (result.ok) { setError(''); setStatus(`외부 편집기: ${result.value}`); } else if (result.error.code !== 'CANCELLED') report(result); } },
    { id: 'extensions.manage', label: '확장 관리', reason: blocked, run: () => setExtensionsOpen(true) },
    ...extensions.commands().map(command => ({ ...command, reason: () => needsWorkspace() ?? command.reason() })),
    { id: 'workspace.open', label: '폴더 열기', reason: blocked, run: open },
    { id: 'workspace.create', label: '새 작업 공간', reason: blocked, run: () => beginCreate('workspace') },
    { id: 'workspace.close', label: '폴더 닫기', reason: needsWorkspace, run: close },
    { id: 'workspace.refresh', label: '폴더 새로 고침', reason: folderReady, run: () => list(session!, folder) },
    { id: 'workspace.newDocument', label: '새 문서', reason: writable, run: () => beginCreate('document') },
    { id: 'workspace.newDirectory', label: '새 폴더', reason: writable, run: () => beginCreate('directory') },
    { id: 'search.text', label: '검색', shortcut: 'Ctrl/Cmd+Shift+F', reason: needsWorkspace, run: () => { setSearchMode('text'); if (layout.narrow) layout.setMobile('left'); layout.update({ ...layout.value, left: { ...layout.value.left, open: true, active: 'search' } }); } },
    { id: 'search.files', label: '빠른 열기', shortcut: 'Ctrl/Cmd+P', reason: needsWorkspace, run: () => setSearchMode('files') },
    { id: 'proposal.open', label: '변경 제안 검토', reason: () => needsWorkspace() ?? (!document ? '먼저 문서를 열어 주세요.' : undefined), run: () => setProposalOpen(true) },
    { id: 'semantic.open', label: '의미·텍스트 비교', reason: () => needsWorkspace() ?? (!document ? '먼저 문서를 열어 주세요.' : undefined), run: () => setSemanticOpen(true) },
    { id: 'validation.open', label: '문서 집합 검증', reason: needsWorkspace, run: () => setValidationOpen(true) },
    { id: 'evidence.open', label: '문서 근거 탐색', reason: needsWorkspace, run: () => setEvidenceOpen(true) },
    { id: 'context.open', label: '문서 맥락 검토', reason: needsWorkspace, run: () => setContextOpen(true) },
    { id: 'relations.open', label: '관계 탐색', reason: needsWorkspace, run: () => setRelationsOpen('list') },
    { id: 'git.open', label: 'Git 이력', reason: needsWorkspace, run: () => setGitOpen(true) },
    { id: 'recovery.open', label: '복구 사본', reason: needsWorkspace, run: () => setRecoveryOpen(true) },
    { id: 'recovery.folder', label: '복구 폴더', reason: blocked, run: async () => { report(await call(() => window.metis.recoveryFolder({ requestId: requestId() }))); } },
    ...(documents.current?.commands() ?? []).map(command => ({ ...command, reason: () => needsWorkspace() ?? (documents.current?.commands().find(item => item.id === command.id)?.reason() ?? (!documents.current ? '편집기를 사용할 수 없습니다.' : undefined)), run: () => documents.current?.commands().find(item => item.id === command.id)?.run() }))
  ];
  currentCommands.current = commands;
  async function dispatch(id: string) {
    if (commandRunning.current) return;
    const command = currentCommands.current.find(item => item.id === id);
    if (!command) { setStatus('명령을 찾을 수 없습니다.'); return; }
    const reason = command.reason(); if (reason) { setStatus(reason); return; }
    commandRunning.current = true;
    try { const error = await executeCommand([{ ...command, reason: () => undefined }], id); if (error) setError(error); }
    finally { commandRunning.current = false; updateCommands(value => value + 1); }
  }
  const commandButton = (id: string, label?: string) => { const command = commands.find(item => item.id === id)!; const reason = command.reason(); return <button key={id} disabled={!!reason} title={reason} onClick={() => { if (menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } layout.setMobile(undefined); void dispatch(id); }}>{label ?? command.label}</button>; };
  const sidebarCommandButton = (id: string, icon: 'refresh' | 'folder' | 'document', label: string) => { const command = commands.find(item => item.id === id)!; const reason = command.reason(); return <button className="sidebar-action" key={id} disabled={!!reason} aria-label={label} title={reason ?? label} data-tooltip={label} onClick={() => void dispatch(id)}><SidebarIcon name={icon} /><span className="sidebar-tooltip" aria-hidden="true">{label}</span></button>; };
  const openGraph = () => { if (!session) return; setGraphOpen(true); setCenterView('graph'); };
  const selectDocumentTab = (path: string) => { documents.current?.activate(path); setCenterView('documents'); };
  const leftVisible = layout.narrow ? layout.mobile === 'left' : layout.value.left.open;
  const rightVisible = layout.narrow ? layout.mobile === 'right' : layout.value.right.open;
  const panelStyle = {
    '--left-width': leftVisible && !layout.narrow ? `${layout.value.left.width}px` : '0px',
    '--right-width': rightVisible && !layout.narrow ? `${layout.value.right.width}px` : '0px',
    '--left-handle': leftVisible && !layout.narrow ? '5px' : '0px',
    '--right-handle': rightVisible && !layout.narrow ? '5px' : '0px',
    '--ui-font-family': appearance.value.uiFontFamily,
    '--ui-font-scale': appearance.value.uiFontSize / 16,
    '--document-font-family': appearance.value.documentFontFamily,
    '--document-font-size': `${appearance.value.documentFontSize}px`
  } as React.CSSProperties;
  return <div data-theme={appearance.value.previewTheme} className={`app workspace-shell ${leftVisible ? 'show-left' : ''} ${rightVisible ? 'show-right' : ''} ${layout.mobile ? `mobile-${layout.mobile}` : ''}`} style={panelStyle}>
    <button className="skip-editor" onClick={() => { const editor = window.document.querySelector<HTMLElement>('.editor-panel:not([hidden]) .cm-content'); if (editor?.getClientRects().length) editor.focus(); else window.document.querySelector<HTMLElement>('main')?.focus(); }}>편집기로 바로 이동</button>
    <nav className="ribbon" aria-label="워크스페이스 리본">
      <details className="workspace-switcher"><summary className="ribbon-button brand-ribbon" aria-label="Metis 작업 공간 전환" title="작업 공간 전환"><span aria-hidden="true">M</span></summary><div className="ribbon-popover"><strong>{session?.name ?? 'Metis'}</strong>{commandButton('workspace.open')}{commandButton('workspace.create')}{session && commandButton('workspace.close')}{recentWarning && <p className="notice">{recentWarning}</p>}{recent.map(item => <article key={item.id}>
        <button className="recent-open" disabled={busy} onClick={() => changeWorkspace(() => window.metis.openRecentWorkspace({ requestId: requestId(), recentId: item.id }))}>{item.name}</button>
        <small>{item.path}</small>{item.state !== 'available' && <p className="notice">{item.state === 'missing' ? '폴더를 찾을 수 없습니다.' : '폴더에 접근할 수 없습니다.'}</p>}
        <div className="tools">{item.state !== 'available' && <button disabled={busy} onClick={open}>다른 위치 선택</button>}<button disabled={busy} aria-label={`${item.name} 최근 목록에서 제거`} onClick={() => removeRecent(item.id)}>목록에서 제거</button></div>
      </article>)}</div></details>
      <div className="ribbon-primary">
        <button ref={filesButton} className={`ribbon-button ${layout.value.left.active === 'files' && leftVisible ? 'active' : ''}`} aria-label="파일" title="파일" aria-pressed={layout.value.left.active === 'files' && leftVisible} onClick={() => layout.activateLeft('files')}><RibbonIcon name="files" /></button>
        <button className={`ribbon-button ${layout.value.left.active === 'search' && leftVisible ? 'active' : ''}`} aria-label="검색" title="검색" disabled={!session} aria-pressed={layout.value.left.active === 'search' && leftVisible} onClick={() => { setSearchMode('text'); layout.activateLeft('search'); }}><RibbonIcon name="search" /></button>
        <button className={`ribbon-button ${layout.value.left.active === 'favorites' && leftVisible ? 'active' : ''}`} aria-label="즐겨찾기" title="즐겨찾기" disabled={!session} aria-pressed={layout.value.left.active === 'favorites' && leftVisible} onClick={() => layout.activateLeft('favorites')}><RibbonIcon name="favorites" /></button>
        <button className={`ribbon-button ${centerView === 'graph' ? 'active' : ''}`} aria-label="그래프" title="그래프" disabled={!session} aria-pressed={centerView === 'graph'} onClick={openGraph}><RibbonIcon name="graph" /></button>
        <button ref={outlineButton} className={`ribbon-button ${rightVisible ? 'active' : ''}`} aria-label="오른쪽 사이드바" title="목차·관계·진단" disabled={!document} aria-pressed={rightVisible} onClick={() => layout.activateRight(layout.value.right.active)}><RibbonIcon name="inspector" /></button>
        <button className="ribbon-button" aria-label="명령 팔레트" title="명령 팔레트" data-focus-home disabled={busy || !!creating} onClick={() => setPaletteOpen(true)}><RibbonIcon name="command" /></button>
      </div>
      <div className="ribbon-secondary"><button className="ribbon-button" aria-label="도움말" title="도움말" onClick={() => setHelpOpen(true)}><RibbonIcon name="help" /></button><button className="ribbon-button" aria-label="설정" title="설정" onClick={() => setSettingsOpen(true)}><RibbonIcon name="settings" /></button>
        <details ref={menu} className="layout-menu ribbon-tools"><summary className="ribbon-button" aria-label="도구 메뉴" title="도구 메뉴"><RibbonIcon name="tools" /></summary><div>
          {document && <>{commandButton('navigation.back')}{commandButton('navigation.forward')}</>}{commandButton('layout.settings')}{commandButton('help.start')}{commandButton('workspace.open')}{commandButton('workspace.create')}{commandButton('extensions.manage')}{commandButton('recovery.folder')}
          {session && <>{commandButton('search.text')}{commandButton('search.files')}{commandButton('recovery.open')}{commandButton('relations.open')}{commandButton('context.open')}{commandButton('evidence.open')}{commandButton('validation.open')}{commandButton('semantic.open')}{commandButton('proposal.open')}{commandButton('git.open')}{commandButton('workspace.close')}</>}
        </div></details>
      </div>
    </nav>
    {layout.mobile && <button className="sidebar-scrim" aria-label="사이드바 닫기" onClick={() => layout.setMobile(undefined)} />}
    <aside className="left-sidebar" aria-label="왼쪽 사이드바" inert={!leftVisible || busy || !!creating}>
      <div className="sidebar-tabs" role="tablist" aria-label="왼쪽 패널"><button role="tab" aria-selected={layout.value.left.active === 'files'} onClick={() => layout.update({ ...layout.value, left: { ...layout.value.left, active: 'files', open: true } })}>파일</button><button role="tab" aria-selected={layout.value.left.active === 'search'} disabled={!session} onClick={() => { setSearchMode('text'); layout.update({ ...layout.value, left: { ...layout.value.left, active: 'search', open: true } }); }}>검색</button><button role="tab" aria-selected={layout.value.left.active === 'favorites'} disabled={!session} onClick={() => layout.update({ ...layout.value, left: { ...layout.value.left, active: 'favorites', open: true } })}>즐겨찾기</button></div>
      {layout.value.left.active === 'files' && <div className="sidebar-panel files-panel"><div className="sidebar-heading"><div><small>WORKSPACE</small><h2>{session?.name ?? '작업 공간'}</h2></div></div>{session && <>
      {session.readOnly && <p className="notice">읽기 전용 폴더</p>}<div className="breadcrumb">/{folder}</div>
      <div className="tools sidebar-actions">{folder && <button className="sidebar-action" disabled={busy || loading} aria-label="상위 폴더" title="상위 폴더" data-tooltip="상위 폴더" onClick={() => list(session, folder.split('/').slice(0, -1).join('/'))}><SidebarIcon name="up" /><span className="sidebar-tooltip" aria-hidden="true">상위 폴더</span></button>}
        {sidebarCommandButton('workspace.refresh', 'refresh', '새로 고침')}
        {sidebarCommandButton('workspace.newDirectory', 'folder', '새 폴더')}{sidebarCommandButton('workspace.newDocument', 'document', '새 문서')}</div>
      <nav className="file-tree" aria-label="파일 탐색">{treeRows()}</nav>
      {loading ? <p>목록을 읽고 있습니다.</p> : !entries.length && <p>표시할 폴더나 AsciiDoc 문서가 없습니다.</p>}</>}</div>}
      {layout.value.left.active === 'search' && session && <Search embedded key={`${session.workspaceId}-${session.workspaceEpoch}-text`} memory={searchMemory.current.text ??= {}} session={session} initialMode="text" close={() => { if (layout.narrow) layout.setMobile(undefined); layout.update({ ...layout.value, left: { ...layout.value.left, active: 'files', open: layout.narrow ? layout.value.left.open : false } }); window.document.querySelector<HTMLButtonElement>('.ribbon-button[aria-label="검색"]')?.focus(); }} open={hit => { void read({ name: hit.label, relativePath: hit.relativePath, kind: 'document' }, hit.kind === 'file' ? undefined : hit.line, hit.revision); }} />}
      {layout.value.left.active === 'favorites' && <div className="sidebar-panel favorites-panel"><h2>즐겨찾기</h2>{favorites.length ? favorites.map(path => <div className={`favorite-row ${document?.relativePath === path ? 'active' : ''}`} key={path}><button title={path} onClick={() => void read({ name: path.split('/').at(-1) ?? path, relativePath: path, kind: 'document' })}>{path}</button><button aria-label={`${path} 즐겨찾기 제거`} onClick={() => toggleFavorite(path)}>★</button></div>) : <p>즐겨찾기한 문서가 없습니다.</p>}</div>}
    </aside>
    {leftVisible && !layout.narrow && <PanelResizer side="left" value={layout.value.left.width} min={180} max={420} resize={layout.resizeLeft} />}
    <main className="center-workspace" tabIndex={-1} aria-label="문서 작업 영역">
      <div className="workspace-tabs" role="tablist" aria-label="열린 뷰" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')], index = tabs.indexOf(event.target as HTMLButtonElement); if (index < 0) return; event.preventDefault(); tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : Math.min(tabs.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)))].focus(); tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : Math.min(tabs.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)))].click(); }}>{documentTabs.map(tab => <div className={`workspace-tab ${centerView === 'documents' && document?.relativePath === tab.path ? 'active' : ''}`} key={tab.path} onContextMenu={event => { event.preventDefault(); setTabContextMenu({ x: event.clientX, y: event.clientY, path: tab.path }); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void documents.current?.closeTab(tab.path); } }}><button role="tab" aria-selected={centerView === 'documents' && document?.relativePath === tab.path} title={tab.path} onClick={() => selectDocumentTab(tab.path)}>{tab.dirty ? '● ' : ''}{tab.path.split('/').at(-1)}</button><button className="tab-close" aria-label={`${tab.path} 탭 닫기`} onClick={() => void documents.current?.closeTab(tab.path)}>×</button></div>)}{graphOpen && <div className={`workspace-tab ${centerView === 'graph' ? 'active' : ''}`} onContextMenu={event => { event.preventDefault(); setTabContextMenu({ x: event.clientX, y: event.clientY, path: 'graph', isGraph: true }); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); setGraphOpen(false); setCenterView('documents'); } }}><button role="tab" aria-selected={centerView === 'graph'} onClick={() => setCenterView('graph')}>◎ 그래프</button><button className="tab-close" aria-label="그래프 탭 닫기" onClick={() => { setGraphOpen(false); setCenterView('documents'); }}>×</button></div>}</div>
      {tabContextMenu && (
        <div
          className="tab-context-menu"
          role="menu"
          aria-label="탭 메뉴"
          style={{ left: Math.min(window.innerWidth - 180, tabContextMenu.x), top: tabContextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {tabContextMenu.isGraph ? (
            <>
              <button role="menuitem" onClick={() => { setGraphOpen(false); setCenterView('documents'); setTabContextMenu(null); }}>그래프 탭 닫기</button>
              <button role="menuitem" disabled={!documentTabs.length} onClick={() => { void documents.current?.closeAllTabs?.(); setTabContextMenu(null); }}>다른 문서 탭 모두 닫기</button>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={() => { void documents.current?.closeTab(tabContextMenu.path); setTabContextMenu(null); }}>탭 닫기</button>
              <button role="menuitem" disabled={documentTabs.length <= 1} onClick={() => { void documents.current?.closeOtherTabs?.(tabContextMenu.path); setTabContextMenu(null); }}>다른 탭 닫기</button>
              <button role="menuitem" disabled={documentTabs.findIndex(t => t.path === tabContextMenu.path) === documentTabs.length - 1} onClick={() => { void documents.current?.closeTabsToRight?.(tabContextMenu.path); setTabContextMenu(null); }}>오른쪽 탭 닫기</button>
              <button role="menuitem" onClick={() => { void documents.current?.closeAllTabs?.(); setTabContextMenu(null); }}>모든 탭 닫기</button>
              <div className="menu-divider" />
              <button role="menuitem" onClick={() => { void window.navigator?.clipboard?.writeText(tabContextMenu.path); setStatus(`${tabContextMenu.path} 경로를 복사했습니다.`); setTabContextMenu(null); }}>문서 경로 복사</button>
              <button role="menuitem" onClick={() => { toggleFavorite(tabContextMenu.path); setTabContextMenu(null); }}>{favorites.includes(tabContextMenu.path) ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기 추가'}</button>
            </>
          )}
        </div>
      )}
      {error && !creating && <div className="operation-status" data-phase="failed"><p role="alert"><strong>작업 실패</strong> — {error}</p><button onClick={() => setError('')}>오류 안내 닫기</button>{document && <details><summary>편집 보존·복구 작업</summary><p>저장·외부 변경 문제라면 현재 편집을 보존하고 원문 상태를 확인하세요.</p>{commandButton('document.preserve')}{commandButton('document.inspect')}{commandButton('recovery.open')}{commandButton('recovery.folder')}</details>}</div>}{warning && <div className="notice">{warning}</div>}
      <div className="document-workspace" hidden={centerView !== 'documents' || !document}><Documents inspectorTarget={inspectorTarget} appearance={appearance.value} stylesheetVersion={stylesheetVersion} favorites={favorites} onToggleFavorite={toggleFavorite} onCommandsChanged={() => updateCommands(value => value + 1)} ref={documents} session={session} onSource={entry => { void read({ name: entry.relativePath, relativePath: entry.relativePath, kind: 'document' }, entry.line); }} onActive={value => { reading.current++; setDocument(value); setActiveAnalysis(undefined); if (!value) setEditorStats(undefined); }} onStats={setEditorStats} onAnalysis={(_path, analysis) => setActiveAnalysis(analysis)} onTabsChanged={(tabs) => setDocumentTabs(tabs)} onError={setError} onStatus={setStatus} onBusy={value => { locked.current = value; setBusy(value); }} /></div>
      {session && graphOpen && <div className="graph-tab-workspace" hidden={centerView !== 'graph'}><Relations embedded key={`${session.workspaceId}-${session.workspaceEpoch}-graph`} session={session} initialPath={document?.relativePath} initialMode="graph" close={() => { setGraphOpen(false); setCenterView('documents'); }} open={(source, revision) => { setCenterView('documents'); void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} /></div>}
      {centerView === 'documents' && !document &&
      <div className="empty"><div className="mark">M</div><h1>{session ? '작업 공간을 열었습니다.' : '문서가 있는 곳에서 시작하세요.'}</h1>
        <p>{session ? loading ? '현재 폴더의 문서 목록을 읽고 있습니다.' : entries.length ? '왼쪽 파일 패널에서 문서를 선택하세요.' : '현재 폴더에 표시할 AsciiDoc 문서가 없습니다.' : '기존 폴더를 열거나 빈 작업 공간을 만드세요.'}</p>
        <div className="empty-actions">{!session ? <>{commandButton('workspace.open')}{commandButton('workspace.create')}</> : <>{commandButton('workspace.newDocument', '이 폴더에 문서 만들기')}<button onClick={() => { if (layout.narrow) layout.setMobile('left'); else layout.update({ ...layout.value, left: { ...layout.value.left, active: 'files', open: true } }); filesButton.current?.focus(); }}>파일 목록 보기</button></>}</div>
        {session?.readOnly && <p>읽기 전용 작업 공간입니다. 새 문서를 만들려면 쓰기 가능한 폴더를 여세요.</p>}
        {!hideHints && <section className="welcome-hint" aria-label="첫 사용 안내"><p>폴더 선택 → .adoc 문서 만들기 → 원문 작성 → 저장 → 다시 열기</p><button onClick={() => setHelpOpen(true)}>작성 방법과 예제 보기</button> <button onClick={() => { setHintsHidden(true); window.document.querySelector<HTMLButtonElement>(".empty-actions button")?.focus(); }}>안내 건너뛰기</button><p>건너뛰어도 도구·보기 또는 명령 팔레트의 ‘시작 안내’에서 다시 볼 수 있습니다.</p></section>}
      </div>}</main>
    {rightVisible && !layout.narrow && <PanelResizer side="right" value={layout.value.right.width} min={220} max={420} resize={layout.resizeRight} />}
    <aside className="right-sidebar" aria-label="오른쪽 사이드바" inert={!rightVisible}><div className="sidebar-tabs" role="tablist" aria-label="오른쪽 패널"><button role="tab" aria-selected={layout.value.right.active === 'outline'} onClick={() => layout.update({ ...layout.value, right: { ...layout.value.right, active: 'outline', open: true } })}>목차</button><button role="tab" aria-selected={layout.value.right.active === 'relations'} onClick={() => layout.update({ ...layout.value, right: { ...layout.value.right, active: 'relations', open: true } })}>관계</button><button role="tab" aria-selected={layout.value.right.active === 'diagnostics'} onClick={() => layout.update({ ...layout.value, right: { ...layout.value.right, active: 'diagnostics', open: true } })}>진단</button></div><div className="sidebar-panel inspector-panel">
      <div ref={setInspectorTarget} hidden={layout.value.right.active !== 'outline'} aria-label="문서 목차" />
      {layout.value.right.active === 'relations' && <section aria-label="문서 관계"><h2>관계</h2>{activeAnalysis?.relations.length ? activeAnalysis.relations.map((item, index) => <button className="inspector-item" key={index} onClick={() => void read({ name: item.destination?.relativePath ?? item.relativePath, relativePath: item.destination?.relativePath ?? item.relativePath, kind: 'document' }, item.destination?.line ?? item.line)}>{item.kind === 'xref' ? '참조' : '포함'} · {item.target}</button>) : <p>활성 문서에서 해석된 관계가 없습니다.</p>}</section>}
      {layout.value.right.active === 'diagnostics' && <section aria-label="문서 진단"><h2>진단</h2>{activeAnalysis?.diagnostics.length ? activeAnalysis.diagnostics.map((item, index) => <button className="inspector-item" key={index} onClick={() => void read({ name: item.relativePath, relativePath: item.relativePath, kind: 'document' }, item.line)}>{item.line} · {item.message}</button>) : <p>활성 문서의 진단이 없습니다.</p>}</section>}
    </div></aside>
    {settingsOpen && <ViewSettings value={layout.value} update={layout.update} appearance={appearance.value} updateAppearance={appearance.update} workspace={!!session} stylesheet={stylesheet} selectStylesheet={selectStylesheet} reloadStylesheet={reloadStylesheet} clearStylesheet={clearStylesheet} warning={[layout.warning, appearance.warning].filter(Boolean).join(' ')} close={() => setSettingsOpen(false)} />}<footer role="status"><span className="footer-status-text">{error ? '작업 실패 · 오류 안내와 해결 행동을 확인하세요.' : busy ? '작업 진행 중 · 완료될 때까지 기다려 주세요.' : status}</span>{document && <span className="footer-document-stats">{editorStats && <span className="footer-stat-badge">{editorStats.words.toLocaleString()} 단어 · {editorStats.chars.toLocaleString()} 자</span>}{editorStats && <span className="footer-stat-badge">줄 {editorStats.line}, 열 {editorStats.col}</span>}<span className="footer-stat-badge">UTF-8{document.bom ? ' BOM' : ''}</span><span className="footer-stat-badge">{document.eol.toUpperCase()}</span><span className="footer-stat-badge">{document.readOnly ? '읽기 전용' : '편집 가능'}</span></span>}</footer>{paletteOpen && <CommandPalette commands={commands} close={() => setPaletteOpen(false)} execute={id => { void dispatch(id); }} />}
    {helpOpen && <GettingStarted workspace={session?.name} documentPath={document?.relativePath} readOnly={session?.readOnly} close={() => setHelpOpen(false)} showHints={() => { setHintsHidden(false); setHelpOpen(false); setStatus('시작 화면 안내를 다시 표시합니다. 문서가 열려 있으면 탭을 닫은 빈 화면에서 확인하세요.'); }} />}
    {extensionsOpen && <ExtensionsPanel runtime={extensions} close={() => setExtensionsOpen(false)} />}
    {extensionView && <ExtensionView key={`${extensionView.owner}-${extensionView.id}`} runtime={extensions} {...extensionView} close={() => setExtensionView(undefined)} />}
    {session && gitOpen && <GitPanel key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} draft={path => documents.current?.draft(path)} restore={(disk, text, expected) => documents.current?.restoreDraft(disk, text, expected) ?? Promise.resolve('편집기를 사용할 수 없습니다.')} close={() => setGitOpen(false)} />}
    {session && document && proposalOpen && <ProposalPanel key={`${session.workspaceId}-${session.workspaceEpoch}-${document.relativePath}`} session={session} path={document.relativePath} draft={() => documents.current?.draft(document.relativePath)} restore={(disk, text, buffer) => documents.current?.restoreDraft(disk, text, buffer) ?? Promise.resolve('편집기를 사용할 수 없습니다.')} close={() => setProposalOpen(false)} />}
    {session && document && semanticOpen && <SemanticPanel key={`${session.workspaceId}-${session.workspaceEpoch}-${document.relativePath}`} session={session} path={document.relativePath} draft={() => documents.current?.draft(document.relativePath)} close={() => setSemanticOpen(false)} />}
    {session && evidenceOpen && <ContextPanel evidenceOnly key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setEvidenceOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && contextOpen && <ContextPanel key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setContextOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && validationOpen && <ContextPanel validationOnly key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setValidationOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && relationsOpen && <Relations key={`${session.workspaceId}-${session.workspaceEpoch}-${relationsOpen}`} session={session} initialPath={document?.relativePath} initialMode={relationsOpen} close={() => setRelationsOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && changingFile && <FileChange key={`${session.workspaceId}-${changingFile}`} session={session} path={changingFile} dirty={path => documents.current?.isDirty(path) ?? false} close={() => setChangingFile(undefined)} applied={(plan, result) => {
      const primary = result.items[0]?.state === 'done';
      if (primary && favorites.includes(plan.relativePath)) updateFavorites(plan.destination ? favorites.map(path => path === plan.relativePath ? plan.destination : path) : favorites.filter(path => path !== plan.relativePath));
      documents.current?.fileChanged(primary ? plan.relativePath : '', primary ? plan.destination : '', [plan.relativePath, ...result.items.map(item => item.relativePath)]);
      void list(session, folder); setStatus(result.items.some(item => item.state === 'failed') ? '파일 변경이 일부 또는 전부 실패했습니다. 항목별 결과를 확인하세요.' : '파일 변경 결과를 확인하세요.');
    }} />}
    {session && recoveryOpen && <RecoveryPanel key={session.workspaceId} session={session} close={() => setRecoveryOpen(false)} />}
    {session && searchMode === 'files' && <Search key={`${session.workspaceId}-${session.workspaceEpoch}-${searchMode}`} memory={searchMemory.current[searchMode] ??= {}} session={session} initialMode={searchMode} close={() => setSearchMode(undefined)} open={hit => { void read({ name: hit.label, relativePath: hit.relativePath, kind: 'document' }, hit.kind === 'file' ? undefined : hit.line, hit.revision); }} />}
    {creating && <dialog ref={createDialog} className="create-dialog" aria-labelledby="create-title" onCancel={event => { event.preventDefault(); if (!busy) setCreating(undefined); }}><form onSubmit={create}>
      <h2 id="create-title">{creating === 'workspace' ? '새 작업 공간' : creating === 'document' ? '새 문서' : '새 폴더'}</h2><p>{creating === 'workspace' ? '이름을 입력한 뒤 상위 폴더를 선택하세요.' : `현재 위치: /${folder}`}</p>
      <label>{creating === 'document' ? '문서 이름 (.adoc)' : '폴더 이름'}<input autoFocus value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {creating === 'document' && <p>이름 끝에 .adoc를 붙이세요. 만들기는 빈 파일을 생성하며, 기존 파일은 덮어쓰지 않습니다. 작성한 내용은 저장을 눌러 기록하세요.</p>}
      {name && !validFolderName(name) && <p>경로 문자, 예약 이름, 이름 끝의 점은 사용할 수 없습니다.</p>}{error && <div role="alert">{error}</div>}
      <div className="tools"><button type="button" disabled={busy} onClick={() => setCreating(undefined)}>취소</button><button type="submit" disabled={busy || !validFolderName(name)}>{creating === 'workspace' ? '상위 폴더 선택' : '만들기'}</button></div>
    </form></dialog>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);


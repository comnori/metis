import { GettingStarted } from './getting-started';
import { ViewSettings } from './view-settings';
import { useLayout } from './layout';
import { ProposalPanel } from './proposal';
import { SemanticPanel } from './semantic-diff';
import { ContextPanel } from './context';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Documents, type DocumentsHandle } from './documents';
import { Search, type SearchMemory } from './search';
import { RecoveryPanel } from './recovery';
import { FileChange } from './file-change';
import { Relations } from './relations';
import { GitPanel } from './git';
import { CommandPalette } from './commands';
import { ExtensionsPanel, ExtensionView, bundledExtensions } from './extensions';
import { ExtensionRuntime } from '@metis/contracts';
import { executeCommand, type Command } from '@metis/contracts';
import type { SearchRequest } from '@metis/contracts';
import './documents.css';
import './preview.css';
import { validFolderName, type Api, type Session, type Entry, type DocumentSnapshot, type Result, type RecentWorkspace } from '@metis/contracts';
import './style.css';
import './workspace.css';
import './layout.css';
import './accessibility.css';
declare global { interface Window { metis: Api } }
const requestId = () => crypto.randomUUID();
const scope = (s: Session) => ({ requestId: requestId(), workspaceId: s.workspaceId, workspaceEpoch: s.workspaceEpoch });
async function call<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try { return await work(); }
  catch { return { ok: false, requestId: 'connection', error: { code: 'INTERNAL_ERROR', message: '앱 연결을 확인한 뒤 다시 시도해 주세요.', retryable: true } }; }
}
function App() {
  const documents = useRef<DocumentsHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hideHints, setHideHints] = useState(() => { try { return localStorage.getItem('metis.welcome.hidden.v1') === 'true'; } catch { return false; } });
  function setHintsHidden(hidden: boolean) { setHideHints(hidden); try { localStorage.setItem('metis.welcome.hidden.v1', String(hidden)); } catch { setStatus('안내 표시 설정을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); } }
  const [session, setSession] = useState<Session>();
  const layout = useLayout(session?.viewKey);
  const menu = useRef<HTMLDetailsElement>(null), filesButton = useRef<HTMLButtonElement>(null), outlineButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key !== 'Escape' || window.document.querySelector('dialog[open]')) return; if (menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } else if (layout.mobile) { (layout.mobile === 'files' ? filesButton : outlineButton).current?.focus(); layout.setMobile(undefined); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [layout.mobile]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [folder, setFolder] = useState('');
  const [document, setDocument] = useState<DocumentSnapshot>();
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
  const [relationsOpen, setRelationsOpen] = useState(false);
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
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || window.document.querySelector('dialog[open]') || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'p' && event.shiftKey) { event.preventDefault(); if (!locked.current) setPaletteOpen(true); return; }
      const id = key === 'p' && !event.shiftKey ? 'search.files' : key === 'f' && event.shiftKey ? 'search.text' : key === 's' && !event.shiftKey ? 'document.save' : undefined;
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
      if (changed) { generation.current++; reading.current++; documents.current?.clear(); setSession(target.session); setWarning(target.session.warning ?? ''); await list(target.session, ''); }
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
  async function list(s: Session, relativePath: string, epoch = generation.current) {
    const token = ++listing.current;
    setLoading(true); setError('');
    const result = await call(() => window.metis.listDirectory({ ...scope(s), relativePath }));
    if (epoch !== generation.current || token !== listing.current) return;
    setLoading(false);
    if (result.ok) { setEntries(result.value); setFolder(relativePath); setStatus('폴더를 열었습니다.'); } else report(result);
  }
  async function changeWorkspace(work: () => Promise<Result<Session>>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (!(await documents.current?.allowLeave())) return;
      const result = await call(work);
      if (!result.ok) { report(result); return; }
      generation.current++; reading.current++;
      setSession(result.value); setWarning(result.value.warning ?? ''); setCreating(undefined);
      documents.current?.clear(); setEntries([]); setFolder('');
      await list(result.value, '');
    } finally { await loadRecents(); locked.current = false; setBusy(false); }
  }
  const open = () => changeWorkspace(() => window.metis.openWorkspace({ requestId: requestId() }));
  function beginCreate(kind: 'workspace' | 'directory' | 'document') { createInvoker.current = window.document.activeElement as HTMLElement; setName(kind === 'document' ? 'untitled.adoc' : ''); setError(''); setCreating(kind); }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!validFolderName(name) || locked.current) return;
    if (creating === 'workspace') return changeWorkspace(() => window.metis.createWorkspace({ requestId: requestId(), name }));
    if (!session) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (creating === 'document') {
        const result = await call(() => window.metis.createDocument({ ...scope(session), relativePath: folder, name }));
        if (result.ok) { setCreating(undefined); await list(session, folder); documents.current?.open(result.value); setStatus('문서를 만들었습니다.'); } else report(result);
      } else {
        const result = await call(() => window.metis.createDirectory({ ...scope(session), relativePath: folder, name }));
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
      generation.current++; setLoading(false); setSession(undefined); setEntries([]); documents.current?.clear();
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
  const blocked = () => locked.current || commandRunning.current ? '진행 중인 작업을 완료하세요.' : settingsOpen || creating || searchMode || recoveryOpen || relationsOpen || gitOpen || changingFile || extensionsOpen || extensionView ? '열린 대화상자를 먼저 닫으세요.' : undefined;
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
    { id: 'search.text', label: '검색', shortcut: 'Ctrl/Cmd+Shift+F', reason: needsWorkspace, run: () => setSearchMode('text') },
    { id: 'search.files', label: '빠른 열기', shortcut: 'Ctrl/Cmd+P', reason: needsWorkspace, run: () => setSearchMode('files') },
    { id: 'proposal.open', label: '변경 제안 검토', reason: () => needsWorkspace() ?? (!document ? '먼저 문서를 열어 주세요.' : undefined), run: () => setProposalOpen(true) },
    { id: 'semantic.open', label: '의미·텍스트 비교', reason: () => needsWorkspace() ?? (!document ? '먼저 문서를 열어 주세요.' : undefined), run: () => setSemanticOpen(true) },
    { id: 'validation.open', label: '문서 집합 검증', reason: needsWorkspace, run: () => setValidationOpen(true) },
    { id: 'evidence.open', label: '문서 근거 탐색', reason: needsWorkspace, run: () => setEvidenceOpen(true) },
    { id: 'context.open', label: '문서 맥락 검토', reason: needsWorkspace, run: () => setContextOpen(true) },
    { id: 'relations.open', label: '관계 탐색', reason: needsWorkspace, run: () => setRelationsOpen(true) },
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
  return <div className={`app ${!layout.value.files ? 'hide-files' : ''} ${!layout.value.outline ? 'hide-outline' : ''} ${layout.mobile ? `mobile-${layout.mobile}` : ''}`} style={{ '--file-width': `${layout.value.fileWidth}px`, '--outline-width': `${layout.value.outlineWidth}px` } as React.CSSProperties}>
    <button className="skip-editor" onClick={() => { const editor = window.document.querySelector<HTMLElement>('.editor-panel:not([hidden]) .cm-content'); if (editor?.getClientRects().length) editor.focus(); else window.document.querySelector<HTMLElement>('main')?.focus(); }}>편집기로 바로 이동</button>
    <header><strong>Metis</strong><div>
      <button ref={filesButton} aria-expanded={layout.narrow ? layout.mobile === 'files' : layout.value.files} onClick={() => layout.toggle('files')}>파일 패널</button>
      <button ref={outlineButton} disabled={!document} aria-expanded={layout.narrow ? layout.mobile === 'outline' : layout.value.outline} onClick={() => layout.toggle('outline')}>목차 패널</button>
      <span className="wide-command">{session && commandButton('search.files')}</span>
      <span className="wide-command">{session && commandButton('search.text')}</span>
      <button data-focus-home disabled={busy || !!creating} onClick={() => setPaletteOpen(true)}>명령 팔레트</button>
      <details ref={menu} className="layout-menu"><summary>도구·보기</summary><div>
        {document && <>{commandButton('navigation.back')}{commandButton('navigation.forward')}</>}
        {commandButton('layout.settings')}{commandButton('help.start')}{commandButton('workspace.open')}{commandButton('workspace.create')}{commandButton('extensions.manage')}{commandButton('recovery.folder')}
        {session && <>{commandButton('search.text')}{commandButton('search.files')}{commandButton('recovery.open')}{commandButton('relations.open')}{commandButton('context.open')}{commandButton('evidence.open')}{commandButton('validation.open')}{commandButton('semantic.open')}{commandButton('proposal.open')}{commandButton('git.open')}{commandButton('workspace.close')}</>}
        <label>파일 패널 너비 {layout.value.fileWidth}px<input type="range" min="180" max="360" step="10" value={layout.value.fileWidth} onChange={e => layout.update({ ...layout.value, fileWidth: Number(e.target.value) })} /></label>
        <label>목차 패널 너비 {layout.value.outlineWidth}px<input type="range" min="140" max="300" step="10" value={layout.value.outlineWidth} onChange={e => layout.update({ ...layout.value, outlineWidth: Number(e.target.value) })} /></label>
        <button onClick={layout.reset}>보기 기본값 복원</button><p>{layout.warning || '작업 공간별 보기 설정입니다. 좁은 창에서는 패널을 임시로 접습니다.'}</p>
      </div></details>
    </div></header>
    <div className="body" inert={busy || !!creating}><aside><h2>{session?.name ?? '작업 공간'}</h2>{session && <>
      {session.readOnly && <p className="notice">읽기 전용 폴더</p>}<div className="breadcrumb">/{folder}</div>
      <div className="tools">{folder && <button disabled={busy || loading} onClick={() => list(session, folder.split('/').slice(0, -1).join('/'))}>상위 폴더</button>}
        {commandButton('workspace.refresh', '새로 고침')}
        {commandButton('workspace.newDirectory')}{commandButton('workspace.newDocument')}</div>
      <nav aria-label="파일 탐색">{entries.map(entry => <div key={entry.relativePath}><button disabled={busy || loading} onClick={() => entry.kind === 'directory' ? list(session, entry.relativePath) : read(entry).then(() => { layout.setMobile(undefined); filesButton.current?.focus(); })}><span>{entry.kind === 'directory' ? '▸' : '≡'}</span>{entry.name}</button>{entry.kind === 'document' && <button disabled={busy || loading || session.readOnly} aria-label={`${entry.name} 파일 변경`} onClick={() => setChangingFile(entry.relativePath)}>⋯</button>}</div>)}</nav>
      {loading ? <p>목록을 읽고 있습니다.</p> : !entries.length && <p>표시할 폴더나 AsciiDoc 문서가 없습니다.</p>}</>}
      <section className="recents"><h2>최근 작업 공간</h2>{recentWarning && <p className="notice">{recentWarning}</p>}
        {!recent.length && !recentWarning && <p>폴더를 열면 여기에 표시됩니다.</p>}
        {recent.map(item => <article key={item.id}>
          <button className="recent-open" disabled={busy} onClick={() => changeWorkspace(() => window.metis.openRecentWorkspace({ requestId: requestId(), recentId: item.id }))}>{item.name}</button>
          <small>{item.path}</small>{item.state !== 'available' && <p className="notice">{item.state === 'missing' ? '폴더를 찾을 수 없습니다.' : '폴더에 접근할 수 없습니다.'}</p>}
          <div className="tools">{item.state !== 'available' && <button disabled={busy} onClick={open}>다른 위치 선택</button>}<button disabled={busy} aria-label={`${item.name} 최근 목록에서 제거`} onClick={() => removeRecent(item.id)}>목록에서 제거</button></div>
        </article>)}</section></aside>
    <main tabIndex={-1} aria-label="문서 작업 영역">{error && !creating && <div className="operation-status" data-phase="failed"><p role="alert"><strong>작업 실패</strong> — {error}</p><button onClick={() => setError('')}>오류 안내 닫기</button>{document && <details><summary>편집 보존·복구 작업</summary><p>저장·외부 변경 문제라면 현재 편집을 보존하고 원문 상태를 확인하세요. 안내를 닫아도 작업을 재실행하지 않습니다.</p>{commandButton('document.preserve')}{commandButton('document.inspect')}{commandButton('recovery.open')}{commandButton('recovery.folder')}</details>}</div>}{warning && <div className="notice">{warning}</div>}
      <Documents onCommandsChanged={() => updateCommands(value => value + 1)} ref={documents} session={session} onSource={entry => { void read({ name: entry.relativePath, relativePath: entry.relativePath, kind: 'document' }, entry.line); }} onActive={value => { reading.current++; setDocument(value); }} onError={setError} onStatus={setStatus} onBusy={value => { locked.current = value; setBusy(value); }} />
      {!document &&
      <div className="empty"><div className="mark">M</div><h1>{session ? '작업 공간을 열었습니다.' : '문서가 있는 곳에서 시작하세요.'}</h1>
        <p>{session ? loading ? '현재 폴더의 문서 목록을 읽고 있습니다.' : entries.length ? '파일 패널에서 문서를 선택하세요. 패널이 접혀 있으면 상단 파일 패널을 누르세요.' : '현재 폴더에 표시할 AsciiDoc 문서가 없습니다. 새 문서를 만들거나 다른 폴더를 선택하세요.' : '기존 폴더를 열거나 빈 작업 공간을 만드세요. 원문은 선택한 폴더에 저장됩니다.'}</p>
        <div className="empty-actions">{!session ? <>{commandButton('workspace.open')}{commandButton('workspace.create')}</> : <>{commandButton('workspace.newDocument', '이 폴더에 문서 만들기')}<button onClick={() => { if (layout.narrow) layout.setMobile('files'); else layout.update({ ...layout.value, files: true }); filesButton.current?.focus(); }}>파일 목록 보기</button></>}</div>
        {session?.readOnly && <p>읽기 전용 작업 공간입니다. 새 문서를 만들려면 쓰기 가능한 폴더를 여세요.</p>}
        {!hideHints && <section className="welcome-hint" aria-label="첫 사용 안내"><p>폴더 선택 → .adoc 문서 만들기 → 원문 작성 → 저장 → 다시 열기</p><button onClick={() => setHelpOpen(true)}>작성 방법과 예제 보기</button> <button onClick={() => { setHintsHidden(true); window.document.querySelector<HTMLButtonElement>(".empty-actions button")?.focus(); }}>안내 건너뛰기</button><p>건너뛰어도 도구·보기 또는 명령 팔레트의 ‘시작 안내’에서 다시 볼 수 있습니다.</p></section>}
      </div>}</main></div>
    {settingsOpen && <ViewSettings value={layout.value} update={layout.update} warning={layout.warning} close={() => setSettingsOpen(false)} />}<footer role="status">{error ? '작업 실패 · 오류 안내와 해결 행동을 확인하세요.' : busy ? '작업 진행 중 · 완료될 때까지 기다려 주세요.' : status}</footer>{paletteOpen && <CommandPalette commands={commands} close={() => setPaletteOpen(false)} execute={id => { void dispatch(id); }} />}
    {helpOpen && <GettingStarted workspace={session?.name} documentPath={document?.relativePath} readOnly={session?.readOnly} close={() => setHelpOpen(false)} showHints={() => { setHintsHidden(false); setHelpOpen(false); setStatus('시작 화면 안내를 다시 표시합니다. 문서가 열려 있으면 탭을 닫은 빈 화면에서 확인하세요.'); }} />}
    {extensionsOpen && <ExtensionsPanel runtime={extensions} close={() => setExtensionsOpen(false)} />}
    {extensionView && <ExtensionView key={`${extensionView.owner}-${extensionView.id}`} runtime={extensions} {...extensionView} close={() => setExtensionView(undefined)} />}
    {session && gitOpen && <GitPanel key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} draft={path => documents.current?.draft(path)} restore={(disk, text, expected) => documents.current?.restoreDraft(disk, text, expected) ?? Promise.resolve('편집기를 사용할 수 없습니다.')} close={() => setGitOpen(false)} />}
    {session && document && proposalOpen && <ProposalPanel key={`${session.workspaceId}-${session.workspaceEpoch}-${document.relativePath}`} session={session} path={document.relativePath} draft={() => documents.current?.draft(document.relativePath)} restore={(disk, text, buffer) => documents.current?.restoreDraft(disk, text, buffer) ?? Promise.resolve('편집기를 사용할 수 없습니다.')} close={() => setProposalOpen(false)} />}
    {session && document && semanticOpen && <SemanticPanel key={`${session.workspaceId}-${session.workspaceEpoch}-${document.relativePath}`} session={session} path={document.relativePath} draft={() => documents.current?.draft(document.relativePath)} close={() => setSemanticOpen(false)} />}
    {session && evidenceOpen && <ContextPanel evidenceOnly key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setEvidenceOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && contextOpen && <ContextPanel key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setContextOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && validationOpen && <ContextPanel validationOnly key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setValidationOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && relationsOpen && <Relations key={`${session.workspaceId}-${session.workspaceEpoch}`} session={session} initialPath={document?.relativePath} close={() => setRelationsOpen(false)} open={(source, revision) => { void read({ name: source.relativePath, relativePath: source.relativePath, kind: 'document' }, source.line, revision); }} />}
    {session && changingFile && <FileChange key={`${session.workspaceId}-${changingFile}`} session={session} path={changingFile} dirty={path => documents.current?.isDirty(path) ?? false} close={() => setChangingFile(undefined)} applied={(plan, result) => {
      const primary = result.items[0]?.state === 'done';
      documents.current?.fileChanged(primary ? plan.relativePath : '', primary ? plan.destination : '', [plan.relativePath, ...result.items.map(item => item.relativePath)]);
      void list(session, folder); setStatus(result.items.some(item => item.state === 'failed') ? '파일 변경이 일부 또는 전부 실패했습니다. 항목별 결과를 확인하세요.' : '파일 변경 결과를 확인하세요.');
    }} />}
    {session && recoveryOpen && <RecoveryPanel key={session.workspaceId} session={session} close={() => setRecoveryOpen(false)} />}
    {session && searchMode && <Search key={`${session.workspaceId}-${session.workspaceEpoch}-${searchMode}`} memory={searchMemory.current[searchMode] ??= {}} session={session} initialMode={searchMode} close={() => setSearchMode(undefined)} open={hit => { void read({ name: hit.label, relativePath: hit.relativePath, kind: 'document' }, hit.kind === 'file' ? undefined : hit.line, hit.revision); }} />}
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


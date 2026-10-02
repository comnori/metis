import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, hoverTooltip } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
import { foldGutter, foldKeymap } from '@codemirror/language';
import type { DocumentSnapshot, Session } from '@metis/contracts';
import type { OutlineEntry } from '@metis/contracts';
import { asciidocLanguage, asciidocHighlighting, asciidocFolding } from './asciidoc-language';
import { Preview, type PreviewPosition } from './preview';
import { autocompletion } from '@codemirror/autocomplete';
import { complete } from './completions';
import type { Analysis } from '@metis/contracts';
import { validFolderName } from '@metis/contracts';
import { Conflict } from './conflict';
import { executeCommand, type Command } from '@metis/contracts';
import type { WorkspaceAppearanceV1 } from '../../shared/model/appearance';
const normalized = (text: string) => text.replace(/\r\n|\r/g, '\n');
interface Tab { previewPosition?: PreviewPosition; baseline: DocumentSnapshot; text: string; view?: EditorView; jumpLine?: number; analysis?: Analysis; analysisText?: string; external?: { message: string; disk?: DocumentSnapshot; missing?: boolean } }
const dirty = (tab: Tab) => tab.text !== normalized(tab.baseline.text) || !!tab.external?.missing;
interface Visit { path: string; text: string; selection: ReturnType<EditorSelection['toJSON']>; top: number; left: number; mode: 'source' | 'split' | 'preview' }
export interface DocumentTabSnapshot { path: string; dirty: boolean }
export interface DocumentsHandle { extensionModel(): import('@metis/contracts').ExtensionModel | undefined; commands(): Command[]; open(document: DocumentSnapshot, line?: number): void; activate(path: string): void; closeTab(path: string): Promise<void>; closeOtherTabs?(path: string): Promise<void>; closeTabsToRight?(path: string): Promise<void>; closeAllTabs?(): Promise<void>; draft(path: string): string | undefined; restoreDraft(disk: DocumentSnapshot, text: string, expectedDraft: string | undefined): Promise<string | undefined>; isDirty(path: string): boolean; fileChanged(source: string, destination: string, affected: string[]): void; clear(): void; allowLeave(): Promise<boolean> }
function jump(tab: Tab, line: number) {
  if (!tab.view) { tab.jumpLine = line; return; }
  const position = tab.view.state.doc.line(Math.max(1, Math.min(tab.view.state.doc.lines, line))).from;
  tab.view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  tab.view.focus();
}
function findLinkAt(text: string, col: number): { path?: string; anchor?: string; label?: string; start: number; end: number } | null {
  const xrefRegex = /xref:([^\s\[]+)(?:\[(.*?)\])?/g;
  let match;
  while ((match = xrefRegex.exec(text)) !== null) {
    if (col >= match.index && col <= match.index + match[0].length) {
      const [path, anchor] = match[1].split('#');
      return { path: path || undefined, anchor, label: match[2], start: match.index, end: match.index + match[0].length };
    }
  }
  const includeRegex = /include::([^\s\[]+)\[(.*?)\]/g;
  while ((match = includeRegex.exec(text)) !== null) {
    if (col >= match.index && col <= match.index + match[0].length) {
      return { path: match[1], label: match[2], start: match.index, end: match.index + match[0].length };
    }
  }
  const anchorRegex = /<<([^\s>,]+)(?:,\s*([^>]*))?>>/g;
  while ((match = anchorRegex.exec(text)) !== null) {
    if (col >= match.index && col <= match.index + match[0].length) {
      const raw = match[1];
      const [path, anchor] = raw.includes('#') ? raw.split('#') : ['', raw];
      return { path: path || undefined, anchor, label: match[2], start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}
function asciidocHoverTooltip(tab: Tab) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    const text = line.text;

    const attrRegex = /(?<!\\)\{([\w-]+)\}/g;
    let match;
    while ((match = attrRegex.exec(text)) !== null) {
      if (col >= match.index && col <= match.index + match[0].length) {
        const attrName = match[1];
        const attr = tab.analysis?.attributes.find(a => a.name === attrName && a.applied);
        return {
          pos: line.from + match.index,
          end: line.from + match.index + match[0].length,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-tooltip-asciidoc';
            if (attr) {
              dom.innerHTML = `<div class="tooltip-title">속성 <code>{${attrName}}</code></div><div class="tooltip-body">${attr.value}</div><div class="tooltip-meta">${attr.relativePath}:${attr.line}</div>`;
            } else {
              dom.innerHTML = `<div class="tooltip-title">속성 <code>{${attrName}}</code></div><div class="tooltip-meta">정의되지 않았거나 미적용 속성</div>`;
            }
            return { dom };
          }
        };
      }
    }

    const link = findLinkAt(text, col);
    if (link) {
      return {
        pos: line.from + link.start,
        end: line.from + link.end,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-tooltip-asciidoc';
          const targetStr = link.path ? (link.anchor ? `${link.path}#${link.anchor}` : link.path) : `#${link.anchor}`;
          dom.innerHTML = `<div class="tooltip-title">링크 대상: <code>${targetStr}</code></div><div class="tooltip-meta">Ctrl+클릭하여 바로 이동</div>`;
          return { dom };
        }
      };
    }
    return null;
  });
}
function resolveDocPath(fromDoc: string, targetPath: string): string {
  if (!targetPath) return fromDoc;
  const parts = fromDoc.includes('/') ? fromDoc.split('/').slice(0, -1) : [];
  for (const segment of targetPath.split('/')) {
    if (segment === '.' || !segment) continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}
function Editor({ tab, changed, save, onSource, onJump }: { tab: Tab; changed(): void; save(): void; onSource?(entry: OutlineEntry): void; onJump?(line: number): void }) {
  const saveCurrent = useRef(save); saveCurrent.current = save;
  const onSourceCurrent = useRef(onSource); onSourceCurrent.current = onSource;
  const onJumpCurrent = useRef(onJump); onJumpCurrent.current = onJump;
  const element = useRef<HTMLDivElement>(null);
  const access = useRef(new Compartment());
  useEffect(() => {
    const readonly = !!tab.baseline.readOnly || tab.baseline.eol === 'mixed';
    tab.view = new EditorView({ parent: element.current!, state: EditorState.create({ doc: tab.text, extensions: [
      lineNumbers(), foldGutter(), asciidocFolding, history(), asciidocLanguage, asciidocHighlighting,
      autocompletion({ override: [context => complete(context, tab.baseline.relativePath, tab.analysis)] }),
      asciidocHoverTooltip(tab),
      keymap.of([{ key: 'Mod-s', run: () => { saveCurrent.current(); return true; } }, ...defaultKeymap, ...historyKeymap, ...foldKeymap]),
      access.current.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '문서 편집기' }),
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (event.key === 'Control' || event.key === 'Meta') view.contentDOM.classList.add('cm-ctrl-pressed');
        },
        keyup(event, view) {
          if (event.key === 'Control' || event.key === 'Meta') view.contentDOM.classList.remove('cm-ctrl-pressed');
        },
        click(event, view) {
          if ((event.ctrlKey || event.metaKey) && event.button === 0) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) {
              const line = view.state.doc.lineAt(pos);
              const link = findLinkAt(line.text, pos - line.from);
              if (link) {
                event.preventDefault();
                const targetDoc = resolveDocPath(tab.baseline.relativePath, link.path ?? '');
                if (targetDoc === tab.baseline.relativePath && link.anchor) {
                  const match = tab.analysis?.anchors.find(a => a.id === link.anchor);
                  if (match) { onJumpCurrent.current?.(match.line); return true; }
                }
                onSourceCurrent.current?.({ relativePath: targetDoc, line: 1, id: link.anchor ?? '', title: link.label ?? '', level: 1 });
                return true;
              }
            }
          }
        }
      }),
      EditorView.updateListener.of(update => { if (update.docChanged) { tab.text = update.state.doc.toString(); changed(); } })] }) });
    if (tab.jumpLine) { jump(tab, tab.jumpLine); tab.jumpLine = undefined; }
    return () => { tab.view?.destroy(); tab.view = undefined; };
  }, [tab]);
  useEffect(() => { const readonly = !!tab.baseline.readOnly || tab.baseline.eol === 'mixed'; tab.view?.dispatch({ effects: access.current.reconfigure([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]) }); }, [tab, tab.baseline.readOnly, tab.baseline.eol]);
  return <div className="source" ref={element} />;
}

export const Documents = forwardRef<DocumentsHandle, { session?: Session; inspectorTarget?: HTMLElement | null; appearance: WorkspaceAppearanceV1; stylesheetVersion: number; favorites: string[]; onToggleFavorite(path: string): void; onSource(entry: OutlineEntry): void; onActive(document?: DocumentSnapshot): void; onAnalysis(path: string, analysis: Analysis): void; onTabsChanged(tabs: DocumentTabSnapshot[], active: string): void; onError(message: string): void; onStatus(message: string): void; onBusy(value: boolean): void; onCommandsChanged(): void }>(function Documents(props, ref) {
  const tabs = useRef(new Map<string, Tab>());
  const [active, setActive] = useState('');
  const activeRef = useRef('');
  const [mode, setMode] = useState<'source' | 'split' | 'preview'>('source');
  const [review, setReview] = useState<{ tab: Tab; disk: DocumentSnapshot }>();
  const [copyName, setCopyName] = useState('recovered.adoc');
  const [, render] = useState(0);
  const saving = useRef(false);
  const draftTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const draftWrites = useRef(new Map<string, Promise<void>>());
  const back = useRef<Visit[]>([]), forward = useRef<Visit[]>([]);
  const current = useRef(props); current.current = props;
  const changed = () => { render(value => value + 1); current.current.onCommandsChanged(); current.current.onTabsChanged([...tabs.current].map(([path, tab]) => ({ path, dirty: dirty(tab) })), activeRef.current); };
  function scheduleDraft(tab: Tab) {
    const session = current.current.session, path = tab.baseline.relativePath;
    const previous = draftTimers.current.get(path); if (previous) clearTimeout(previous);
    draftTimers.current.set(path, setTimeout(() => {
      draftTimers.current.delete(path);
      if (!session || current.current.session !== session || tabs.current.get(path) !== tab || !dirty(tab)) return;
      const write = window.metis.writeDraft({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: path, revision: tab.baseline.revision, text: tab.text })
        .then(result => { if (!result.ok) current.current.onError(`임시 초안을 보존하지 못했습니다: ${result.error.message}`); })
        .catch(() => current.current.onError('임시 초안을 보존하지 못했습니다.'))
        .finally(() => { if (draftWrites.current.get(path) === write) draftWrites.current.delete(path); });
      draftWrites.current.set(path, write);
    }, 250));
  }
  async function deleteDraft(path: string, session = current.current.session) {
    const timer = draftTimers.current.get(path); if (timer) { clearTimeout(timer); draftTimers.current.delete(path); }
    await draftWrites.current.get(path);
    if (!session || current.current.session !== session) return;
    await window.metis.deleteDraft({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: path }).catch(() => undefined);
  }
  const select = (path: string) => { activeRef.current = path; setActive(path); };
  function location(): Visit | undefined {
    const tab = tabs.current.get(active), view = tab?.view;
    if (!tab || !view) return;
    return { path: active, text: tab.text, selection: view.state.selection.toJSON(), top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft, mode };
  }
  function remember() {
    const point = location(); if (!point) return;
    back.current = [...back.current, point].slice(-100); forward.current = [];
  }
  function travel(direction: 'back' | 'forward') {
    if (saving.current) return;
    const from = direction === 'back' ? back : forward, to = direction === 'back' ? forward : back;
    let point = from.current.pop();
    while (point && !tabs.current.has(point.path)) point = from.current.pop();
    if (!point) { props.onStatus('돌아갈 열린 문서가 없습니다. 닫힌 탭의 이력은 건너뜁니다.'); changed(); return; }
    const present = location(); if (present) to.current = [...to.current, present].slice(-100);
    const tab = tabs.current.get(point.path)!;
    select(point.path); setMode(point.mode); props.onActive(tab.baseline);
    if (tab.text === point.text && tab.view) {
      tab.view.dispatch({ selection: EditorSelection.fromJSON(point.selection) });
      const view = tab.view, target = point;
      requestAnimationFrame(() => { if (view.dom.isConnected && !view.dom.closest('[hidden]')) { view.scrollDOM.scrollTo(target.left, target.top); view.focus(); } });
      props.onStatus('열린 편집 문서의 이전 위치로 돌아왔습니다. 디스크 상태는 별도로 확인합니다.');
    } else props.onStatus('이력 이후 편집 내용이 바뀌어 이전 위치로 이동하지 않았습니다. 현재 편집을 유지합니다.');
    changed(); void inspect(tab);
  }
  async function inspect(tab: Tab) {
    const session = current.current.session; if (!session || saving.current) return;
    const baseline = tab.baseline;
    try {
      const result = await window.metis.readDocument({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: baseline.relativePath });
      if (saving.current || tab.baseline !== baseline || tabs.current.get(baseline.relativePath) !== tab || current.current.session !== session) return;
      if (!result.ok) tab.external = { missing: result.error.code === 'NOT_FOUND' || tab.external?.missing, message: result.error.code === 'NOT_FOUND' ? '디스크에서 파일이 삭제되거나 이동되었습니다. 편집 내용은 유지됩니다.' : result.error.message };
      else if (result.value.revision !== baseline.revision) {
        if (dirty(tab)) tab.external = { message: '외부 변경과 편집 내용이 충돌합니다.', disk: result.value };
        else { tabs.current.set(baseline.relativePath, { baseline: result.value, text: normalized(result.value.text) }); current.current.onStatus(`${baseline.relativePath}: 외부 변경을 반영했습니다.`); }
      } else { tab.external = undefined; tab.baseline = { ...baseline, readOnly: result.value.readOnly }; }
      changed();
    } catch { if (tabs.current.get(baseline.relativePath) === tab) { tab.external = { message: '외부 변경을 확인하지 못했습니다. 다시 확인해 주세요.' }; changed(); } }
  }
  useEffect(() => {
    let alive = true, running = false;
    const check = async () => { if (running || saving.current) return; running = true; try { for (const tab of tabs.current.values()) { if (!alive) break; await inspect(tab); } } finally { running = false; } };
    const timer = setInterval(() => { void check(); }, 3000); window.addEventListener('focus', check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [props.session]);
  async function preserve(tab: Tab) {
    const session = current.current.session!;
    const result = await window.metis.checkpointDocument({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: tab.baseline.relativePath, text: tab.text });
    if (!result.ok) throw new Error(result.error.message);
  }
  async function resolve(text: string, useDisk: boolean): Promise<string | undefined> {
    if (!review || saving.current || !props.session) return '현재 해결 작업을 시작할 수 없습니다.';
    const { tab, disk } = review; saving.current = true; props.onBusy(true);
    try {
      await preserve(tab);
      const scope = { requestId: crypto.randomUUID(), workspaceId: props.session.workspaceId, workspaceEpoch: props.session.workspaceEpoch, relativePath: disk.relativePath };
      const result = useDisk ? await window.metis.readDocument(scope) : await window.metis.saveDocument({ ...scope, revision: disk.revision, text: normalized(text) });
      if (!result.ok) return result.error.message;
      if (useDisk && result.value.revision !== disk.revision) return '디스크가 다시 변경되었습니다. 취소 후 새 비교를 열어 주세요.';
      const next = useDisk ? normalized(result.value.text) : normalized(text);
      tab.baseline = result.value; tab.external = undefined;
      if (tab.view) tab.view.dispatch({ changes: { from: 0, to: tab.view.state.doc.length, insert: next } });
      tab.text = next; props.onError(''); props.onStatus('편집 사본을 보존하고 충돌을 해결했습니다.'); changed();
    } catch (error) { return error instanceof Error ? error.message : '충돌 해결에 실패했습니다.'; }
    finally { saving.current = false; props.onBusy(false); }
  }
  async function keepOrCopy(tab: Tab, copy: boolean) {
    if (saving.current || !props.session) return;
    saving.current = true; props.onBusy(true);
    try {
      if (copy) {
        const result = await window.metis.copyDocument({ requestId: crypto.randomUUID(), workspaceId: props.session.workspaceId, workspaceEpoch: props.session.workspaceEpoch, relativePath: '', name: copyName, text: tab.text });
        if (!result.ok) throw new Error(result.error.message);
        props.onStatus(`${result.value.relativePath}에 사본을 저장했습니다. 기존 탭은 유지됩니다.`);
      } else { await preserve(tab); props.onStatus('편집 내용을 복구 사본으로 보존했습니다.'); }
    } catch (error) { props.onError(error instanceof Error ? error.message : '사본 저장 실패'); }
    finally { saving.current = false; props.onBusy(false); changed(); }
  }
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (saving.current || [...tabs.current.values()].some(dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  async function allowLeave() {
    if (saving.current) return false;
    if (![...tabs.current.values()].some(dirty)) return true;
    try { const result = await window.metis.confirmDiscard({ requestId: crypto.randomUUID() }); return result.ok && result.value; }
    catch { props.onError('닫기 확인을 완료하지 못했습니다. 편집 내용은 유지됩니다.'); return false; }
  }
  useImperativeHandle(ref, () => ({ commands: documentCommands,
    extensionModel() { const tab = tabs.current.get(active); if (!tab?.analysis || tab.analysisText !== tab.text) return; return { path: active, outline: tab.analysis.outline, references: tab.analysis.relations.length, diagnostics: tab.analysis.diagnostics.length }; },
    draft(path) { return tabs.current.get(path)?.text; },
    async restoreDraft(disk, text, expectedDraft) {
      const session = current.current.session, existing = tabs.current.get(disk.relativePath);
      if (!session || saving.current) return '편집 작업이 진행 중입니다.';
      if (existing?.text !== expectedDraft) return '검토 이후 편집 내용이 바뀌었습니다. 다시 비교하세요.';
      if (disk.readOnly || disk.eol === 'mixed') return '읽기 전용 또는 혼합 줄바꿈 문서는 초안을 적용할 수 없습니다.';
      saving.current = true; current.current.onBusy(true);
      try {
        const scope = { requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: disk.relativePath };
        const retained = await window.metis.checkpointDocument({ ...scope, text: existing?.text ?? normalized(disk.text) });
        if (!retained.ok) return retained.error.message;
        const latest = await window.metis.readDocument({ ...scope, requestId: crypto.randomUUID() });
        if (!latest.ok) return latest.error.message;
        if (latest.value.revision !== disk.revision || current.current.session !== session || tabs.current.get(disk.relativePath)?.text !== expectedDraft) return '검토 이후 원본 또는 편집이 바뀌었습니다. 다시 비교하세요.';
        if (latest.value.readOnly || latest.value.eol === 'mixed') return '문서를 변경할 수 없습니다.';
        const next = normalized(text);
        if (existing) {
          existing.baseline = latest.value; existing.external = undefined;
          existing.view?.dispatch({ changes: { from: 0, to: existing.view.state.doc.length, insert: next } }); existing.text = next;
        } else tabs.current.set(disk.relativePath, { baseline: latest.value, text: next });
        select(disk.relativePath); setMode('source'); current.current.onActive(latest.value); changed();
        current.current.onStatus('기존 내용을 복구 사본으로 보존하고 검토한 내용을 편집 초안에 반영했습니다. 저장은 별도로 실행하세요.');
      } catch { return '초안을 적용하지 못했습니다. 기존 편집과 복구 사본을 확인하세요.'; }
      finally { saving.current = false; current.current.onBusy(false); }
    },
    fileChanged(source, destination, affected) {
      const tab = tabs.current.get(source);
      if (tab && tab.text === normalized(tab.baseline.text)) {
        tabs.current.delete(source);
        if (activeRef.current === source) { select(''); props.onActive(undefined); }
        if (destination) props.onSource({ relativePath: destination, line: 1, id: '', title: '', level: 1 });
      }
      for (const path of affected) { const existing = tabs.current.get(path); if (existing) { existing.analysis = undefined; void inspect(existing); } }
      changed();
    },
    isDirty(path) { const tab = tabs.current.get(path); return !!tab && dirty(tab); },
    open(document, line) {
      if (document.relativePath !== active || line) remember();
      let existing = tabs.current.get(document.relativePath);
      if (existing && !dirty(existing) && existing.baseline.revision !== document.revision) { tabs.current.delete(document.relativePath); existing = undefined; }
      if (!existing) {
        const tab: Tab = { baseline: document, text: normalized(document.text) }; tabs.current.set(document.relativePath, tab);
        const session = current.current.session;
        if (session) void window.metis.readDraft({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: document.relativePath }).then(result => {
          if (!result.ok || !result.value || current.current.session !== session || tabs.current.get(document.relativePath) !== tab || tab.text !== normalized(document.text)) return;
          const draft = result.value;
          if (draft.text === normalized(document.text)) { void deleteDraft(document.relativePath, session); return; }
          if (draft.revision !== document.revision) { tab.baseline = { ...document, revision: draft.revision }; tab.external = { message: '앱을 종료한 뒤 디스크가 변경되었습니다. 복원한 임시 초안과 충돌합니다.', disk: document }; }
          tab.text = draft.text;
          tab.view?.dispatch({ changes: { from: 0, to: tab.view.state.doc.length, insert: draft.text } });
          current.current.onStatus(`${document.relativePath}: 저장하지 않은 임시 초안을 복원했습니다.`); changed();
        }).catch(() => current.current.onError('임시 초안을 확인하지 못했습니다.'));
      }
      if (line) { jump(tabs.current.get(document.relativePath)!, line); setMode('split'); }
      select(document.relativePath); props.onActive(existing?.baseline ?? document); changed();
    },
    activate(path) { const tab = tabs.current.get(path); if (!tab || path === activeRef.current) return; remember(); select(path); current.current.onActive(tab.baseline); changed(); },
    closeTab: close,
    async closeOtherTabs(path: string) {
      for (const p of Array.from(tabs.current.keys())) {
        if (p !== path) await close(p);
      }
    },
    async closeTabsToRight(path: string) {
      const allPaths = Array.from(tabs.current.keys());
      const idx = allPaths.indexOf(path);
      if (idx >= 0) {
        for (const p of allPaths.slice(idx + 1)) await close(p);
      }
    },
    async closeAllTabs() {
      for (const p of Array.from(tabs.current.keys())) await close(p);
    },
    clear() { tabs.current.clear(); back.current = []; forward.current = []; setReview(undefined); select(''); props.onActive(undefined); changed(); }, allowLeave
  }));
  async function save(path: string) {
    const tab = tabs.current.get(path), session = current.current.session;
    if (!tab || !session || saving.current || !dirty(tab)) return;
    saving.current = true; current.current.onBusy(true); current.current.onError(''); current.current.onStatus('문서 저장 중 · 시작한 저장은 취소할 수 없습니다.'); changed();
    const text = tab.text;
    try {
      const result = await window.metis.saveDocument({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch,
        relativePath: path, revision: tab.baseline.revision, text });
      if (result.ok) { tab.baseline = result.value; tab.external = undefined; await deleteDraft(path, session); current.current.onStatus('저장했습니다.'); }
      else { current.current.onError(result.error.message); current.current.onStatus('저장하지 못했습니다. 편집 내용은 유지됩니다.'); }
    } catch { current.current.onError('저장 응답을 받지 못했습니다. 편집 내용과 복구 사본을 확인해 주세요.'); }
    finally { saving.current = false; current.current.onBusy(false); changed(); void inspect(tab); }
  }
  async function close(path: string) {
    const tab = tabs.current.get(path); if (!tab || saving.current) return;
    if (dirty(tab)) {
      try { const result = await window.metis.confirmDiscard({ requestId: crypto.randomUUID() }); if (!result.ok || !result.value) return; }
      catch { props.onError('닫기 확인을 완료하지 못했습니다.'); return; }
    }
    tabs.current.delete(path);
    await deleteDraft(path);
    if (activeRef.current === path) { const next = tabs.current.keys().next().value ?? ''; select(next); props.onActive(tabs.current.get(next)?.baseline); }
    changed();
  }
  async function openExternal() {
    const tab = tabs.current.get(active), session = current.current.session;
    if (!tab || !session || saving.current) return;
    try {
      if (dirty(tab)) {
        const choice = await window.metis.externalDecision({ requestId: crypto.randomUUID() });
        if (!choice.ok) { current.current.onError(choice.error.message); return; }
        if (choice.value === 'cancel') return;
        if (choice.value === 'save') { await save(tab.baseline.relativePath); if (dirty(tab)) return; }
      }
      if (current.current.session !== session || tabs.current.get(tab.baseline.relativePath) !== tab) return;
      saving.current = true; current.current.onBusy(true);
      const result = await window.metis.openExternal({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: tab.baseline.relativePath });
      if (result.ok) { current.current.onError(''); current.current.onStatus('외부 편집기에 저장본 열기를 요청했습니다. 미저장 편집은 Metis에 유지됩니다.'); } else current.current.onError(result.error.message);
    } catch { current.current.onError('외부 편집기 요청을 완료하지 못했습니다.'); }
    finally { saving.current = false; current.current.onBusy(false); changed(); }
  }
  function documentCommands(): Command[] {
    const tab = tabs.current.get(active);
    const reason = () => saving.current ? '저장·보존 작업이 진행 중입니다.' : !tab ? '먼저 문서를 여세요.' : undefined;
    return [
      { id: 'navigation.back', label: '탐색 뒤로', reason: () => reason() ?? (!back.current.some(point => tabs.current.has(point.path)) ? '돌아갈 열린 문서가 없습니다.' : undefined), run: () => travel('back') },
      { id: 'navigation.forward', label: '탐색 앞으로', reason: () => reason() ?? (!forward.current.some(point => tabs.current.has(point.path)) ? '이동할 열린 문서가 없습니다.' : undefined), run: () => travel('forward') },
      { id: 'document.external', label: '외부 편집기로 열기', reason, run: openExternal },
      { id: 'document.save', label: '문서 저장', shortcut: 'Ctrl/Cmd+S', reason: () => reason() ?? (tab!.baseline.readOnly || tab!.baseline.eol === 'mixed' ? '읽기 전용 또는 혼합 줄바꿈 문서입니다.' : tab!.external?.missing ? '디스크에 문서가 없습니다. 사본 저장을 사용하세요.' : !dirty(tab!) ? '저장하지 않은 변경이 없습니다.' : undefined), run: () => save(active) },
      { id: 'document.preserve', label: '편집 보존', reason, run: () => keepOrCopy(tab!, false) },
      { id: 'document.inspect', label: '외부 변경 확인', reason, run: () => inspect(tab!) },
      ...(['source', 'split', 'preview'] as const).map(mode => ({ id: `document.${mode}`, label: { source: '원문 보기', split: '분할 보기', preview: '미리보기' }[mode], reason, run: () => setMode(mode) }))
    ];
  }
  async function runDocumentCommand(id: string) { const error = await executeCommand(documentCommands(), id); if (error) current.current.onStatus(error); }
  const selected = tabs.current.get(active), analyzedText = selected?.text;
  return <section className="documents" hidden={!selected}>
    {selected && <div className="document-title"><div className="document-heading"><div className="document-name"><button className={`document-star ${props.favorites.includes(active) ? 'starred' : ''}`} aria-label={`${active} ${props.favorites.includes(active) ? '즐겨찾기 제거' : '즐겨찾기 추가'}`} aria-pressed={props.favorites.includes(active)} onClick={() => props.onToggleFavorite(active)}>{props.favorites.includes(active) ? '★' : '☆'}</button><h1>{active}</h1></div><span className={dirty(selected) ? 'document-state dirty' : 'document-state'}>{selected.baseline.readOnly || selected.baseline.eol === 'mixed' ? '읽기 전용' : dirty(selected) ? '저장하지 않은 변경' : '저장됨'} · UTF-8{selected.baseline.bom ? ' BOM' : ''} · {selected.baseline.eol.toUpperCase()}</span></div>
      <div className="document-toolbar"><div className="action-group edit-actions"><button className="save-action" disabled={!!documentCommands().find(command => command.id === 'document.save')?.reason()} onClick={() => runDocumentCommand('document.save')}>저장</button>
        <button className="compact-action" title="실행 취소" aria-label="실행 취소" onClick={() => selected.view && undo(selected.view)}>↶</button><button className="compact-action" title="다시 실행" aria-label="다시 실행" onClick={() => selected.view && redo(selected.view)}>↷</button></div>
        <details className="document-more"><summary aria-label="문서 도구" title="문서 도구">⋯</summary><div><button disabled={saving.current} onClick={() => runDocumentCommand('document.external')}>외부 편집기로 열기</button><button disabled={saving.current} onClick={() => runDocumentCommand('document.inspect')}>외부 변경 확인</button><button disabled={saving.current} onClick={() => runDocumentCommand('document.preserve')}>편집 보존</button></div></details>
        <div className="view-switcher" aria-label="문서 보기"><button aria-pressed={mode === 'source'} onClick={() => runDocumentCommand('document.source')}>원문</button><button aria-pressed={mode === 'split'} onClick={() => runDocumentCommand('document.split')}>분할</button><button aria-pressed={mode === 'preview'} onClick={() => runDocumentCommand('document.preview')}>미리보기</button></div></div></div>}
    {selected?.external && <div className="external-change" role="status">{selected.external.message}<div className="tools">{selected.external.disk && <button disabled={saving.current} onClick={() => setReview({ tab: selected, disk: selected.external!.disk! })}>변경 비교</button>}<button disabled={saving.current} onClick={() => runDocumentCommand('document.inspect')}>다시 확인</button></div><div className="copy-controls"><input aria-label="사본 파일 이름" value={copyName} onChange={event => setCopyName(event.target.value)} /><button disabled={saving.current || !validFolderName(copyName) || !/\.adoc$/i.test(copyName)} onClick={() => keepOrCopy(selected, true)}>다른 이름으로 저장</button></div></div>}
    {review && <Conflict baseline={review.tab.baseline} disk={review.disk} text={review.tab.text} close={() => setReview(undefined)} resolve={resolve} />}
    <div className={`document-body mode-${mode}`}>
      <div className="editors" hidden={mode === 'preview'}>{[...tabs.current].map(([path, tab]) => <div className="editor-panel" hidden={path !== active} key={path}><Editor tab={tab} changed={() => { scheduleDraft(tab); changed(); }} save={() => void runDocumentCommand('document.save')} onSource={props.onSource} onJump={line => jump(tab, line)} /></div>)}</div>
      {selected && props.session && <Preview appearance={props.appearance} stylesheetVersion={props.stylesheetVersion} inspector={false} inspectorTarget={props.inspectorTarget} key={active} position={selected.previewPosition ??= { x: 0, y: 0, outline: 0 }} editorLine={() => selected.view?.state.doc.lineAt(selected.view.state.selection.main.head).number ?? 1} reveal={() => setMode('split')} session={props.session} relativePath={active} text={selected.text} mode={mode} onAnalysis={value => { selected.analysis = value; selected.analysisText = analyzedText; props.onAnalysis(active, value); }} navigate={entry => { setMode('split'); if (entry.relativePath === active) jump(selected, entry.line); else props.onSource(entry); }} />}
    </div>

  </section>;
});

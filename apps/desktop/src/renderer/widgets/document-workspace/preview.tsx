import type { AttachmentResource, ExtensionRuntime, ExtensionPreviewResult, PreviewAsset } from '@metis/contracts';
import { createPortal } from 'react-dom';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import { OperationStatus } from '../../shared/ui/operation-status';
import type { Analysis, OutlineEntry, Session } from '@metis/contracts';
import { defaultAppearance, previewThemeStyles, type WorkspaceAppearanceV1 } from '../../shared/model/appearance';
import { asciidoctorPreviewCss, highlightPreviewCss } from './preview-theme';
import { mountPreviewAssets } from '../../shared/lib/preview-assets';
import { d2ExportData, d2PreviewStyles, followD2BoardLink, installD2DownloadMenus } from '../../shared/lib/d2-preview';
import type { D2ExportFormat } from '@metis/contracts';
import { validWebLink, type Relation } from '@metis/contracts';
import { followPreviewFragment, previewDestination, previewRelations } from './preview-links';
export function safePreview(html: string, appearance: WorkspaceAppearanceV1 = defaultAppearance, assets: ReadonlyMap<string, PreviewAsset> = new Map(), resources: AttachmentResource[] = [], relations: Relation[] = []): string {
  // Explain removed embeds without allowing any source-provided iframe into the preview.
  const source = document.createElement('template'); source.innerHTML = html;
  for (const frame of source.content.querySelectorAll('iframe')) {
    const note = document.createElement('p'); note.className = 'metis-embed-unavailable';
    note.textContent = '영상을 표시할 수 없습니다. 확장 관리에서 YouTube 영상의 활성화 상태와 video::영상ID[youtube] 문법을 확인하세요.';
    frame.replaceWith(note);
  }
  html = source.innerHTML;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'], FORBID_ATTR: ['style', 'srcset', 'target', 'download'] });
  const template = document.createElement('template'); template.innerHTML = clean;
  const fragment = template.content;
  for (const blocked of fragment.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta,base')) blocked.remove();
  for (const element of fragment.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    if (attribute.name.toLowerCase().startsWith('on') || ['style', 'srcset', 'target', 'download'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
  }
  for (const element of fragment.querySelectorAll('*')) {
    element.removeAttribute('data-attachment-token');
    element.removeAttribute('data-attachment-target');
    element.removeAttribute('data-web-url');
    element.removeAttribute('data-document-target');
    for (const name of ['data-d2-export', 'data-d2-asset', 'data-d2-index', 'data-d2-board-link', 'data-d2-menu-toggle', 'data-d2-menu']) element.removeAttribute(name);
    element.removeAttribute('autoplay');
    for (const attr of ['src', 'poster']) {
      const target = element.getAttribute(attr); if (target === null) continue;
      const resource = resources.find(r => r.target === target);
      const allowed = attr === 'poster' || element.tagName === 'IMG' ? resource?.kind === 'image' : ['AUDIO', 'VIDEO'].includes(element.tagName) ? resource?.kind === 'audio' || resource?.kind === 'video' : false;
      if (allowed && resource?.url && /^metis-attachment:\/\/resource\/[\w-]+$/.test(resource.url)) element.setAttribute(attr, resource.url + (/^#t=[0-9.,]+$/.test(target.slice(target.indexOf('#'))) ? target.slice(target.indexOf('#')) : ''));
      else {
        element.removeAttribute(attr);
        if (attr === 'src' && ['IMG', 'AUDIO', 'VIDEO'].includes(element.tagName)) element.setAttribute('hidden', '');
        const note = fragment.ownerDocument.createElement('span'); note.className = 'attachment-error';
        note.textContent = '첨부: ' + target + ' — ' + (resource?.error ?? '표시할 수 없는 로컬 미디어입니다.'); element.after(note);
      }
      if (attr === 'src' && resource?.token && ['IMG', 'AUDIO', 'VIDEO'].includes(element.tagName)) {
        element.setAttribute('data-attachment-token', resource.token);
        const link = fragment.ownerDocument.createElement('a'); link.textContent = '첨부 열기'; link.className = 'metis-attachment-link'; link.href = '#'; link.dataset.attachmentToken = resource.token; element.after(link);
      }
    }
    if (['AUDIO', 'VIDEO'].includes(element.tagName)) { element.setAttribute('controls', ''); element.setAttribute('preload', 'metadata'); }
  }
  for (const anchor of fragment.querySelectorAll('a[href]')) {
    const target = anchor.getAttribute('href')!; if (target.startsWith('#')) continue;
    if (validWebLink(target)) { anchor.setAttribute('href', '#'); anchor.setAttribute('data-web-url', target); anchor.setAttribute('title', '시스템 브라우저에서 열기: ' + target); continue; }
    const matches = previewRelations(target, relations);
    if (matches.length) {
      anchor.removeAttribute('href');
      if (previewDestination(target, relations)) { anchor.setAttribute('href', '#'); anchor.setAttribute('data-document-target', target); }
      else { const note = fragment.ownerDocument.createElement('span'); note.textContent = ' (참조 위치를 확인하지 못했습니다. 관계 탐색에서 확인하세요.)'; anchor.after(note); }
      continue;
    }
    const resource = resources.find(r => r.target === target); anchor.removeAttribute('href');
    if (resource?.token) { anchor.setAttribute('href', '#'); anchor.setAttribute('data-attachment-token', resource.token); }
    else { const note = fragment.ownerDocument.createElement('span'); note.textContent = ' (' + (resource?.error ?? '외부 링크는 지원하지 않습니다.') + ')'; anchor.after(note); }
  }
  const hasVideo = mountPreviewAssets(fragment, assets);
  const hasD2 = [...assets.values()].some(asset => asset.kind === 'd2');
  const metisCss = `body{color-scheme:${appearance.previewTheme === 'dark' ? 'dark' : 'light'};font-size:${appearance.documentFontSize}px;font-family:${appearance.documentFontFamily};line-height:1.7;padding:24px;overflow-wrap:anywhere}pre{overflow-x:auto;white-space:pre}code,pre{font-family:inherit}.metis-attachment-link{font-size:.8em;margin-left:.5em}.attachment-error{color:#9b3526;white-space:normal}img,video{max-width:100%}.metis-youtube iframe{border:0;max-width:100%;aspect-ratio:16/9}.metis-embed-unavailable{border-left:4px solid #777;padding:.75em}.metis-mermaid{margin:1.25em 0;text-align:center}.metis-mermaid .title{font-weight:600;margin-bottom:.5em}.metis-mermaid-output svg{max-width:100%;height:auto}.metis-mermaid-error{border-left:4px solid #b42318;padding:.75em;text-align:left}${previewThemeStyles[appearance.previewTheme]}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src metis-attachment: ${hasD2 ? 'data: https:' : ''}; font-src ${hasD2 ? 'data:' : "'none'"}; media-src metis-attachment:; frame-src ${hasVideo ? 'https://www.youtube-nocookie.com' : "'none'"}; form-action 'none'; base-uri 'none'"><style data-theme="asciidoctor">${asciidoctorPreviewCss}</style><style data-theme="highlight">${highlightPreviewCss}</style><style data-theme="metis">${metisCss}${d2PreviewStyles}</style></head><body>${template.innerHTML}</body></html>`;
}
export function showAttachmentErrors(doc: Document) {
  for (const media of doc.querySelectorAll<HTMLImageElement | HTMLMediaElement>('img,audio,video')) {
    let reported = false;
    const failed = () => {
      if (reported || !media.getAttribute('src')) return;
      reported = true;
      const note = doc.createElement('span'); note.className = 'attachment-error';
      note.textContent = '첨부를 표시하거나 재생할 수 없습니다. 파일 형식과 코덱을 확인하거나 첨부 열기를 사용하세요.'; media.after(note);
    };
    media.addEventListener('error', failed, { once: true });
    // A small or invalid resource can finish before the iframe load callback.
    if ('error' in media ? media.error : media.complete && !media.naturalWidth) failed();
  }
}
export interface PreviewPosition { text?: string; html?: string; x: number; y: number; outline: number }
export function Preview({ extensions, session, relativePath, text, mode, navigate, onAnalysis, position, editorLine, reveal, appearance, stylesheetVersion, inspector = true, inspectorTarget }: { extensions: ExtensionRuntime; session: Session; relativePath: string; text: string; mode: 'source' | 'split' | 'preview'; navigate(entry: OutlineEntry): void; onAnalysis(value: Analysis): void; position: PreviewPosition; editorLine(): number; reveal(): void; appearance: WorkspaceAppearanceV1; stylesheetVersion: number; inspector?: boolean; inspectorTarget?: HTMLElement | null }) {
  const [analysis, setAnalysis] = useState<Analysis>();
  const [basis, setBasis] = useState<string>();
  const current = !!analysis && basis === text;
  const outline = useRef<HTMLElement>(null), pendingId = useRef<string | undefined>(undefined);
  const restore = useRef({ x: position.x, y: position.y });
  const removeScroll = useRef<() => void>(() => {});
  useEffect(() => () => removeScroll.current(), []);
  const [status, setStatus] = useState('해석 준비 중');
  const [failedAttachment, setFailedAttachment] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [running, setRunning] = useState(true);
  const [customCss, setCustomCss] = useState('');
  const extensionVersion = useSyncExternalStore(listener => extensions.subscribe(listener), extensions.version);
  const [previewResult, setPreviewResult] = useState<{ analysis: Analysis; theme: string; version: number; value: ExtensionPreviewResult }>();
  const extensionPreview = previewResult?.analysis === analysis && previewResult?.theme === appearance.previewTheme && previewResult?.version === extensionVersion ? previewResult.value : undefined;
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
  // Labels depend on accepted analysis, not keystrokes or preview status updates.
  const outlineLabels = useMemo(() => analysis?.outline.map(entry => new DOMParser().parseFromString(DOMPurify.sanitize(entry.title, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }), 'text/html').body.textContent) ?? [], [analysis?.outline]);
  useEffect(() => {
    const controller = new AbortController();
    if (!analysis || !current) return;
    accepted.current(analysis);
    void extensions.renderPreview({ html: analysis.html, theme: appearance.previewTheme, readD2File: async path => {
      if (controller.signal.aborted) throw Error('Cancelled');
      const result = await window.metis.readD2File({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: path });
      if (controller.signal.aborted) throw Error('Cancelled');
      if (!result.ok) throw Error(`${path}: ${result.error.message}`);
      return result.value;
    } }, controller.signal).then(value => {
      if (!value || controller.signal.aborted) return;
      setPreviewResult({ analysis, theme: appearance.previewTheme, version: extensionVersion, value });
      accepted.current({ ...analysis, diagnostics: [...analysis.diagnostics, ...value.diagnostics] });
    });
    return () => controller.abort();
  }, [analysis, current, appearance.previewTheme, extensions, extensionVersion]);
  const displayAnalysis = analysis && extensionPreview?.diagnostics.length ? { ...analysis, diagnostics: [...analysis.diagnostics, ...extensionPreview.diagnostics] } : analysis;
  const [attachmentResources, setAttachmentResources] = useState<{ html: string; items: AttachmentResource[] }>();
  const renderedHtml = extensionPreview?.html ?? analysis?.html ?? '';
  useEffect(() => {
    let alive = true, group: string | undefined;
    setFailedAttachment(undefined);
    const scope = { requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath };
    const dom = new DOMParser().parseFromString(DOMPurify.sanitize(renderedHtml, { FORBID_TAGS: ['iframe', 'object', 'embed'] }), 'text/html');
    const targets = [...new Set([...dom.querySelectorAll('img[src],audio[src],video[src],video[poster],a[href]')].flatMap(e => ['src', 'poster', 'href'].map(a => e.getAttribute(a)).filter((v): v is string => !!v && !v.startsWith('#') && !(e.tagName === 'A' && (validWebLink(v) || previewRelations(v, analysis?.relations ?? []).length > 0)))))].slice(0, 1000);
    const release = () => { if (group) void window.metis.attachments({ ...scope, action: 'release', group }).catch(() => {}); };
    void window.metis.attachments({ ...scope, action: 'register', targets }).then(result => {
      if (result.ok) { group = result.value.group; if (alive) setAttachmentResources({ html: renderedHtml, items: result.value.resources }); else release(); }
      else if (alive) setStatus(result.error.message);
    }).catch(() => { if (alive) setStatus('첨부 리소스를 준비하지 못했습니다.'); });
    return () => { alive = false; release(); };
  }, [renderedHtml, analysis, session.workspaceId, session.workspaceEpoch, relativePath]);
  const srcDoc = useMemo(() => safePreview(renderedHtml, appearance, extensionPreview?.assets, attachmentResources?.html === renderedHtml ? attachmentResources.items : [], analysis?.relations), [renderedHtml, extensionPreview, appearance, attachmentResources, analysis]);
  useEffect(() => {
    let alive = true;
    if (!appearance.customCssEnabled) { setCustomCss(''); return; }
    void window.metis.readPreviewStylesheet({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch }).then(result => {
      if (!alive) return;
      if (result.ok) { setCustomCss(result.value.active ? result.value.css ?? '' : ''); if (result.value.warning) setStatus(result.value.warning); }
      else { setCustomCss(''); setStatus(result.error.message); }
    });
    return () => { alive = false; };
  }, [session.workspaceId, session.workspaceEpoch, analysis, retry, appearance.customCssEnabled, stylesheetVersion]);
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
    removeScroll.current(); const win = frame.current?.contentWindow, doc = frame.current?.contentDocument; if (!win || !doc) return;
    const removeD2Menus = installD2DownloadMenus(doc);
    const openAttachment = async (token: string, reveal = false) => {
      const result = await window.metis.attachments({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath, action: 'open', token, reveal });
      const error = result.ok ? result.value.errors.join(' · ') : result.error.message;
      if (error) {
        setStatus(error);
        if (!reveal) setFailedAttachment(token);
      }
    };
    doc.addEventListener('click', event => {
      const target = event.target as Element;
      const d2Export = target.closest<HTMLElement>('button[data-d2-export]');
      if (d2Export) {
        event.preventDefault();
        const asset = extensionPreview?.assets.get(d2Export.dataset.d2Asset ?? '');
        if (asset) {
          d2Export.setAttribute('disabled', '');
          void window.metis.exportD2({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, ...d2ExportData(asset, Number(d2Export.dataset.d2Index), d2Export.dataset.d2Export as D2ExportFormat) })
            .then(result => { setStatus(result.ok ? result.value.saved ? 'D2 다이어그램을 저장했습니다.' : 'D2 저장을 취소했습니다.' : result.error.message); })
            .catch(() => setStatus('D2 다이어그램을 저장하지 못했습니다.')).finally(() => d2Export.removeAttribute('disabled'));
        }
        return;
      }
      const boardLink = target.closest('a[data-d2-board-link]');
      if (boardLink) { event.preventDefault(); followD2BoardLink(boardLink); return; }
      const documentLink = target.closest?.('a[data-document-target]');
      if (documentLink) { event.preventDefault(); const destination = previewDestination(documentLink.getAttribute('data-document-target')!, analysis?.relations ?? []); if (destination) go(destination); return; }
      const webLink = target.closest?.('a[data-web-url]');
      if (webLink) {
        event.preventDefault();
        void window.metis.openWebLink({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, url: webLink.getAttribute('data-web-url')! }).then(result => { if (!result.ok) setStatus(result.error.message); }).catch(() => setStatus('브라우저를 열지 못했습니다.'));
        return;
      }
      const link = target.closest?.('a[data-attachment-token]');
      if (link) { event.preventDefault(); void openAttachment(link.getAttribute('data-attachment-token')!).catch(() => setStatus('첨부파일을 열지 못했습니다.')); return; }
      followPreviewFragment(event, doc);
    });
    showAttachmentErrors(doc);
    let custom = doc.querySelector<HTMLStyleElement>('style[data-metis-custom]');
    if (!custom) { custom = doc.createElement('style'); custom.dataset.metisCustom = ''; doc.head.append(custom); }
    custom.textContent = customCss;
    win.scrollTo(restore.current.x, restore.current.y);
    const save = () => { if (visibleMode.current === 'source' || !navigationReady.current) return; position.x = win.scrollX; position.y = win.scrollY; };
    win.addEventListener('scroll', save, { passive: true }); removeScroll.current = () => { win.removeEventListener('scroll', save); removeD2Menus(); };
    if (pendingId.current && mode !== 'source' && current && !running) { const id = pendingId.current; pendingId.current = undefined; scrollToId(id); }
  };
  useEffect(() => { const custom = frame.current?.contentDocument?.querySelector<HTMLStyleElement>('style[data-metis-custom]'); if (custom) custom.textContent = customCss; }, [customCss]);
  const inspectorContent = <aside className="outline" ref={outline} onScroll={e => { position.outline = e.currentTarget.scrollTop; }}><h2>목차</h2><OperationStatus task="문서 해석" phase={running ? 'running' : current ? 'complete' : 'failed'} message={status} next={!running && !current ? '원문을 확인하고 미리보기 새로 고침을 누르세요. 원문 편집은 계속할 수 있습니다.' : undefined} /><button disabled={!current || running} onClick={alignEditor}>편집 위치와 맞추기</button><p>절 시작 위치로 맞춥니다. 본문 내부의 세부 위치는 동기화하지 않습니다. 원문이 바뀌면 이전 미리보기 위치를 초기화합니다.</p><button onClick={() => setRetry(value => value + 1)}>미리보기 새로 고침</button>
      {analysis?.outline.map((entry, index) => <div key={`${entry.id}-${index}`}><button className="outline-item" style={{ paddingLeft: 8 + Math.min(entry.level, 6) * 8 }} disabled={!current || running} onClick={() => jump(entry)}>{outlineLabels[index]}<small>{entry.relativePath}:{entry.line}</small></button>{entry.relativePath === relativePath && <button disabled={!current || running} onClick={() => navigate(entry)}>원문 위치 열기: {entry.line}</button>}{entry.relativePath !== relativePath && <button disabled={!current || running} onClick={() => navigate(entry)}>포함 원문 열기: {entry.relativePath}</button>}</div>)}
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
      {!!displayAnalysis?.diagnostics.length && <section aria-label="해석 진단"><h3>진단</h3>{displayAnalysis.diagnostics.map((d, index) => <p key={index}>{d.relativePath}:{d.line} — {d.message}</p>)}</section>}
      <p>로컬 미디어와 첨부 링크를 지원합니다. YouTube 영상은 확장 관리에서 활성화할 수 있습니다.</p>
    </aside>;
  return <div className={`analysis analysis-${mode}`}>
    {inspectorTarget ? createPortal(inspectorContent, inspectorTarget) : inspector && inspectorContent}
    <div className="preview-surface" hidden={mode === 'source'}><p role="status">{running || !current ? '미리보기 갱신 대기 · 이전 내용일 수 있습니다.' : '현재 편집 기준 · 포함·참조 파일은 해석 시점 저장본'}</p><span role="status">{failedAttachment && <button onClick={() => { void window.metis.attachments({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath, action: 'open', token: failedAttachment, reveal: true }).then(result => { if (!result.ok) setStatus(result.error.message); else setFailedAttachment(undefined); }).catch(() => setStatus('파일 위치를 열지 못했습니다.')); }}>파일 위치 열기</button>}</span><iframe ref={frame} onLoad={loaded} title="AsciiDoc 미리보기" sandbox={srcDoc.includes('frame-src https://www.youtube-nocookie.com') ? "allow-same-origin allow-scripts allow-presentation" : "allow-same-origin"} allow="fullscreen" srcDoc={srcDoc} /></div>
  </div>;
}

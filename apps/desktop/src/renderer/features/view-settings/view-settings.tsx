import React, { useEffect, useRef, useState } from 'react';
import type { PreviewStylesheet } from '@metis/contracts';
import { DialogShell } from '../../shared/ui/dialog-shell';
import { defaultLayout, type WorkspaceLayoutV3 } from '../../shared/model/layout';
import { defaultAppearance, documentFontPresets, uiFontPresets, validFontFamily, type WorkspaceAppearanceV1 } from '../../shared/model/appearance';
import './view-settings.css';

export type SettingsCategory = 'layout' | 'editor' | 'preview' | 'extensions' | 'external';
export interface SettingsTarget { category: SettingsCategory; settingId?: string }
export const settingsCategories: { id: SettingsCategory; label: string; description: string }[] = [
  { id: 'layout', label: '화면과 배치', description: '파일 검색 즐겨찾기 좌측 우측 사이드바 목차 관계 진단 패널 표시 너비' },
  { id: 'editor', label: '글꼴과 편집기', description: '폰트 UI AsciiDoc 문서 글꼴 크기 font-family' },
  { id: 'preview', label: '미리보기', description: '테마 기본 다크 세피아 CSS 스타일' },
  { id: 'extensions', label: '확장', description: '플러그인 설치 활성 비활성 제거 Mermaid D2 YouTube GitHub' },
  { id: 'external', label: '외부 도구', description: '외부 편집기 실행 파일 연결 관리 AI 서버' }
];
const settingsItems: { id: string; category: SettingsCategory; label: string; keywords: string }[] = [
  { id: 'left-panel', category: 'layout', label: '좌측 사이드바', keywords: '파일 검색 즐겨찾기 패널 표시 너비' },
  { id: 'right-panel', category: 'layout', label: '우측 사이드바', keywords: '목차 관계 진단 패널 표시 너비' },
  { id: 'fonts', category: 'editor', label: '글꼴과 크기', keywords: 'UI AsciiDoc 문서 폰트 크기 font-family' },
  { id: 'preview-theme', category: 'preview', label: '미리보기 테마', keywords: 'CSS 스타일 기본 다크 세피아' },
  { id: 'extensions', category: 'extensions', label: '확장 관리', keywords: '설치 활성 비활성 제거 Mermaid D2 YouTube GitHub 플러그인' },
  { id: 'external-editor', category: 'external', label: '외부 편집기', keywords: '실행 파일 연결 도구' }
];
interface Undo { layout?: WorkspaceLayoutV3; appearance?: Partial<WorkspaceAppearanceV1> }
export function ViewSettings({ value, update, appearance, updateAppearance, workspace, stylesheet, selectStylesheet, reloadStylesheet, clearStylesheet, close, warning, target, extensions, extensionsBusy = false, configureEditor }: {
  value: WorkspaceLayoutV3; update(value: WorkspaceLayoutV3): void;
  appearance: WorkspaceAppearanceV1; updateAppearance(value: WorkspaceAppearanceV1): void;
  workspace: boolean; stylesheet: PreviewStylesheet;
  selectStylesheet(): Promise<void>; reloadStylesheet(): Promise<void>; clearStylesheet(): Promise<void>;
  close(): void; warning: string; target?: SettingsTarget; extensions?: React.ReactNode; extensionsBusy?: boolean; configureEditor?(): Promise<void>;
}) {
  const [category, setCategory] = useState<SettingsCategory>(target?.category ?? 'layout');
  const [query, setQuery] = useState(''), [previous, setPrevious] = useState<Undo>();
  const [detail, setDetail] = useState(false), [pending, setPending] = useState(false), [actionError, setActionError] = useState('');
  const [uiDraft, setUiDraft] = useState(appearance.uiFontFamily), [documentDraft, setDocumentDraft] = useState(appearance.documentFontFamily), [fontError, setFontError] = useState('');
  const [advanced, setAdvanced] = useState(false), content = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState(target?.settingId);
  useEffect(() => { setUiDraft(appearance.uiFontFamily); setDocumentDraft(appearance.documentFontFamily); }, [appearance.uiFontFamily, appearance.documentFontFamily]);
  useEffect(() => { if (target) { setCategory(target.category); setFocusId(target.settingId); setDetail(!!target.settingId); } }, [target]);
  useEffect(() => { if (!focusId) return; const node = content.current?.querySelector<HTMLElement>(`[data-setting="${focusId}"]`); node?.scrollIntoView({ block: 'nearest' }); node?.focus(); setFocusId(undefined); }, [category, focusId, query]);
  function changeLayout(next: WorkspaceLayoutV3) { setPrevious({ layout: structuredClone(value) }); update(next); }
  function changeAppearance(patch: Partial<WorkspaceAppearanceV1>) {
    const before = Object.fromEntries(Object.keys(patch).map(key => [key, appearance[key as keyof WorkspaceAppearanceV1]]));
    if (Object.entries(patch).every(([key, next]) => appearance[key as keyof WorkspaceAppearanceV1] === next)) return;
    setPrevious({ appearance: before }); updateAppearance({ ...appearance, ...patch });
  }
  function resetCategory() {
    if (category === 'layout') changeLayout(structuredClone(defaultLayout));
    if (category === 'editor') changeAppearance({ uiFontFamily: defaultAppearance.uiFontFamily, uiFontSize: defaultAppearance.uiFontSize, documentFontFamily: defaultAppearance.documentFontFamily, documentFontSize: defaultAppearance.documentFontSize });
    if (category === 'preview') changeAppearance({ previewTheme: defaultAppearance.previewTheme, customCssEnabled: false });
  }
  function undo() { if (previous?.layout) update(previous.layout); if (previous?.appearance) updateAppearance({ ...appearance, ...previous.appearance, ...(!stylesheet.name ? { customCssEnabled: false } : {}) }); setPrevious(undefined); }
  const commitFont = (kind: 'ui' | 'document') => {
    const draft = (kind === 'ui' ? uiDraft : documentDraft).trim();
    if (!validFontFamily(draft)) { setFontError('글꼴 이름·따옴표·쉼표만 입력하세요.'); return; }
    setFontError(''); changeAppearance({ [kind === 'ui' ? 'uiFontFamily' : 'documentFontFamily']: draft });
  };
  async function perform(action: () => Promise<void>) { setPending(true); setActionError(''); try { await action(); } catch (error) { setActionError(error instanceof Error ? error.message : '변경을 완료하지 못했습니다. 다시 시도해 주세요.'); } finally { setPending(false); } }
  function navigate(next: SettingsCategory, id?: string) { setCategory(next); setQuery(''); setDetail(true); setFocusId(id); content.current?.scrollTo(0, 0); }
  const preset = (font: string, presets: Record<string, string>) => Object.values(presets).includes(font) ? font : 'custom';
  const found = settingsItems.filter(item => { const text = `${item.label} ${item.keywords} ${settingsCategories.find(c => c.id === item.category)?.label}`.toLocaleLowerCase(); return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word)); });
  const resettable = ['layout', 'editor', 'preview'].includes(category);
  return <DialogShell title="설정" size="large" className={`view-settings ${detail ? 'settings-detail-open' : ''}`} description={workspace ? '현재 작업 공간 · 변경 즉시 적용' : '작업 공간을 열면 글꼴과 미리보기 설정을 저장할 수 있습니다.'} close={close} canClose={!pending && !extensionsBusy}
    auxiliary={<>{resettable && <button disabled={pending || (!workspace && category !== 'layout')} onClick={resetCategory}>이 범주 기본값 복원</button>}<button disabled={!previous || pending} onClick={undo}>직전 변경 되돌리기</button></>}
    status={warning || actionError || (pending || extensionsBusy ? '변경 중…' : '설정 저장됨 · 변경 즉시 반영')}>
    <div className="settings-layout"><nav className="settings-nav" aria-label="설정 카테고리">
      <label className="settings-search">설정 검색<input autoFocus data-dialog-initial-focus disabled={extensionsBusy} type="search" placeholder="항목 이름으로 찾기" value={query} onChange={e => { setQuery(e.target.value); setDetail(false); }} /></label>
      {settingsCategories.map(item => <button key={item.id} disabled={extensionsBusy} aria-current={!query && category === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}
    </nav><div className="settings-content" ref={content}>
      <button className="settings-back" onClick={() => setDetail(false)}>‹ 설정 카테고리</button>
      {query.trim() ? <section aria-label="설정 검색 결과"><h3>검색 결과</h3>{found.length ? found.map(item => <button className="settings-result" key={item.id} onClick={() => navigate(item.category, item.id)}><strong>{item.label}</strong><span>{settingsCategories.find(c => c.id === item.category)?.label}</span></button>) : <p role="status">일치하는 설정이 없습니다. 패널·글꼴·테마·확장으로 검색하세요.</p>}</section> : <>
      <h3>{settingsCategories.find(item => item.id === category)?.label}</h3>
      {category === 'layout' && <><p>사이드바는 경계선을 드래그해서도 조절할 수 있습니다.</p>
        <fieldset data-setting="left-panel" tabIndex={-1}><legend>좌측 사이드바</legend><label><input type="checkbox" checked={value.left.open} onChange={e => changeLayout({ ...value, left: { ...value.left, open: e.target.checked } })} />넓은 창에서 좌측 사이드바 표시</label><label>너비 {value.left.width}px<input type="range" min="240" max="420" step="10" value={value.left.width} onChange={e => changeLayout({ ...value, left: { ...value.left, width: Number(e.target.value) } })} /></label></fieldset>
        <fieldset data-setting="right-panel" tabIndex={-1}><legend>우측 사이드바</legend><label><input type="checkbox" checked={value.right.open} onChange={e => changeLayout({ ...value, right: { ...value.right, open: e.target.checked } })} />넓은 창에서 우측 사이드바 표시</label><label>너비 {value.right.width}px<input type="range" min="220" max="420" step="10" value={value.right.width} onChange={e => changeLayout({ ...value, right: { ...value.right, width: Number(e.target.value) } })} /></label></fieldset>
      </>}
      {category === 'editor' && <fieldset data-setting="fonts" tabIndex={-1} disabled={!workspace}><legend>글꼴과 크기</legend>
        <label>UI 글꼴 프리셋<select value={preset(appearance.uiFontFamily, uiFontPresets)} onChange={e => { if (e.target.value === 'custom') setAdvanced(true); else changeAppearance({ uiFontFamily: e.target.value }); }}><option value={uiFontPresets.system}>기본 산세리프</option><option value={uiFontPresets.native}>시스템 UI</option><option value={uiFontPresets.serif}>세리프</option><option value="custom">직접 입력</option></select></label>
        <label>UI 크기 {appearance.uiFontSize}px<input type="range" min="12" max="22" step="1" value={appearance.uiFontSize} onChange={e => changeAppearance({ uiFontSize: Number(e.target.value) })} /></label>
        <label>AsciiDoc 글꼴 프리셋<select value={preset(appearance.documentFontFamily, documentFontPresets)} onChange={e => { if (e.target.value === 'custom') setAdvanced(true); else changeAppearance({ documentFontFamily: e.target.value }); }}><option value={documentFontPresets.code}>코드 글꼴</option><option value={documentFontPresets.system}>시스템 본문</option><option value={documentFontPresets.serif}>세리프 본문</option><option value="custom">직접 입력</option></select></label>
        <label>AsciiDoc 크기 {appearance.documentFontSize}px<input type="range" min="10" max="32" step="1" value={appearance.documentFontSize} onChange={e => changeAppearance({ documentFontSize: Number(e.target.value) })} /></label>
        <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>고급: 글꼴 이름 직접 입력</summary><label>UI font-family<input value={uiDraft} maxLength={256} onChange={e => setUiDraft(e.target.value)} onBlur={() => commitFont('ui')} /></label><label>AsciiDoc font-family<input value={documentDraft} maxLength={256} onChange={e => setDocumentDraft(e.target.value)} onBlur={() => commitFont('document')} /></label></details>
        <div className="font-example" style={{ fontFamily: appearance.documentFontFamily, fontSize: appearance.documentFontSize }}>문서를 읽고, 생각을 연결하세요.<br />= 나의 첫 문서</div>{fontError && <p role="alert">{fontError}</p>}
      </fieldset>}
      {category === 'preview' && <fieldset data-setting="preview-theme" tabIndex={-1} disabled={!workspace || pending}><legend>AsciiDoc 미리보기 테마</legend>
        <label>내장 테마<select value={appearance.previewTheme} onChange={e => changeAppearance({ previewTheme: e.target.value as WorkspaceAppearanceV1['previewTheme'] })}><option value="default">기본</option><option value="dark">다크</option><option value="sepia">세피아</option></select></label>
        <label><input type="checkbox" checked={appearance.customCssEnabled} disabled={!stylesheet.name} onChange={e => changeAppearance({ customCssEnabled: e.target.checked })} />사용자 CSS를 내장 테마 위에 적용</label>
        <p>{stylesheet.name ? `연결된 CSS: ${stylesheet.name}` : '연결된 사용자 CSS가 없습니다.'}{stylesheet.warning && ` · ${stylesheet.warning}`}</p>
        <div className="tools"><button onClick={() => void perform(selectStylesheet)}>CSS 파일 선택</button><button disabled={!stylesheet.name} onClick={() => void perform(reloadStylesheet)}>다시 읽기</button><button disabled={!stylesheet.name} onClick={() => void perform(clearStylesheet)}>CSS 연결 해제</button></div>
        <p>사용자 CSS는 미리보기에만 적용됩니다. 기본값 복원은 CSS 적용을 끄며 파일 연결은 유지합니다.</p>
      </fieldset>}
      {category === 'extensions' && <section data-setting="extensions" tabIndex={-1}>{extensions}</section>}
      {category === 'external' && <section data-setting="external-editor" tabIndex={-1}><h4>외부 편집기</h4><p>AsciiDoc 문서를 함께 편집할 프로그램의 실행 파일을 선택하세요.</p><button disabled={pending} onClick={() => configureEditor && void perform(configureEditor)}>외부 편집기 선택</button><h4>확장 연결</h4><p>설치한 확장의 연결은 확장 관리에서 설정할 수 있습니다.</p><button onClick={() => navigate('extensions')}>확장 관리로 이동</button><h4>AI와 외부 Agent</h4><p>모델과 서버는 문서 근거 탐색·변경 제안에서 요청마다 확인합니다. 전송은 해당 화면에서 승인한 뒤 실행합니다.</p></section>}
      </>}{actionError && <p role="alert">{actionError}</p>}{warning && <p role="alert">{warning}</p>}
    </div></div>
  </DialogShell>;
}

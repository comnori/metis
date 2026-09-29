import React, { useEffect, useRef, useState } from 'react';
import type { PreviewStylesheet } from '@metis/contracts';
import { openDialog, useSearchDialogEscape } from '../../shared/lib/accessibility';
import { defaultLayout, type WorkspaceLayoutV2 } from '../../shared/model/layout';
import { defaultAppearance, documentFontPresets, uiFontPresets, validFontFamily, type WorkspaceAppearanceV1 } from '../../shared/model/appearance';

interface Previous { layout: WorkspaceLayoutV2; appearance: WorkspaceAppearanceV1 }
export function ViewSettings({ value, update, appearance, updateAppearance, workspace, stylesheet, selectStylesheet, reloadStylesheet, clearStylesheet, close, warning }: {
  value: WorkspaceLayoutV2; update(value: WorkspaceLayoutV2): void;
  appearance: WorkspaceAppearanceV1; updateAppearance(value: WorkspaceAppearanceV1): void;
  workspace: boolean; stylesheet: PreviewStylesheet;
  selectStylesheet(): Promise<void>; reloadStylesheet(): Promise<void>; clearStylesheet(): Promise<void>;
  close(): void; warning: string;
}) {
  const escape = useSearchDialogEscape(close);
  const dialog = useRef<HTMLDialogElement>(null), [query, setQuery] = useState(''), [previous, setPrevious] = useState<Previous>();
  const [uiDraft, setUiDraft] = useState(appearance.uiFontFamily), [documentDraft, setDocumentDraft] = useState(appearance.documentFontFamily), [fontError, setFontError] = useState('');
  useEffect(() => openDialog(dialog.current!), []);
  useEffect(() => { setUiDraft(appearance.uiFontFamily); setDocumentDraft(appearance.documentFontFamily); }, [appearance.uiFontFamily, appearance.documentFontFamily]);
  const matches = (label: string) => !query.trim() || label.includes(query.trim());
  const left = matches('좌측 파일 검색 즐겨찾기 패널 표시 너비'), right = matches('우측 목차 관계 진단 패널 표시 너비');
  const fonts = matches('글꼴 폰트 크기 UI AsciiDoc 편집기 미리보기'), theme = matches('AsciiDoc 미리보기 테마 CSS 기본 다크 세피아');
  const commitFont = (kind: 'ui' | 'document') => {
    const draft = kind === 'ui' ? uiDraft : documentDraft;
    if (!validFontFamily(draft)) { setFontError('글꼴은 이름·따옴표·쉼표로 구성된 font-family만 입력하세요.'); return; }
    setFontError(''); updateAppearance({ ...appearance, [kind === 'ui' ? 'uiFontFamily' : 'documentFontFamily']: draft });
  };
  const preset = (font: string, presets: Record<string, string>) => Object.values(presets).includes(font) ? font : 'custom';
  return <dialog {...escape} ref={dialog} className="recovery-dialog view-settings" aria-label="보기 설정" onCancel={e => { e.preventDefault(); close(); }}>
    <h2>보기 설정</h2><p>패널 배치와 글꼴·테마는 현재 작업 공간에 즉시 적용됩니다. 좁은 창의 오버레이 열림 상태는 저장하지 않습니다.</p>
    <label>설정 검색<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {left && <fieldset><legend>좌측 사이드바</legend><label><input type="checkbox" checked={value.left.open} onChange={e => update({ ...value, left: { ...value.left, open: e.target.checked } })} />넓은 창에서 좌측 사이드바 표시</label><label>너비 {value.left.width}px<input type="range" min="180" max="420" step="10" value={value.left.width} onChange={e => update({ ...value, left: { ...value.left, width: Number(e.target.value) } })} /></label></fieldset>}
    {right && <fieldset><legend>우측 사이드바</legend><label><input type="checkbox" checked={value.right.open} onChange={e => update({ ...value, right: { ...value.right, open: e.target.checked } })} />넓은 창에서 우측 사이드바 표시</label><label>너비 {value.right.width}px<input type="range" min="220" max="420" step="10" value={value.right.width} onChange={e => update({ ...value, right: { ...value.right, width: Number(e.target.value) } })} /></label></fieldset>}
    {fonts && <fieldset disabled={!workspace}><legend>글꼴과 크기</legend>
      {!workspace && <p>폰트와 테마를 저장하려면 작업 공간을 여세요.</p>}
      <label>UI 글꼴 프리셋<select value={preset(appearance.uiFontFamily, uiFontPresets)} onChange={e => { if (e.target.value !== 'custom') updateAppearance({ ...appearance, uiFontFamily: e.target.value }); }}><option value={uiFontPresets.system}>기본 산세리프</option><option value={uiFontPresets.native}>시스템 UI</option><option value={uiFontPresets.serif}>세리프</option><option value="custom">직접 입력</option></select></label>
      <label>UI font-family<input value={uiDraft} maxLength={256} onChange={e => setUiDraft(e.target.value)} onBlur={() => commitFont('ui')} /></label>
      <label>UI 크기 {appearance.uiFontSize}px<input type="range" min="12" max="22" step="1" value={appearance.uiFontSize} onChange={e => updateAppearance({ ...appearance, uiFontSize: Number(e.target.value) })} /></label>
      <label>AsciiDoc 글꼴 프리셋<select value={preset(appearance.documentFontFamily, documentFontPresets)} onChange={e => { if (e.target.value !== 'custom') updateAppearance({ ...appearance, documentFontFamily: e.target.value }); }}><option value={documentFontPresets.code}>코드 글꼴</option><option value={documentFontPresets.system}>시스템 본문</option><option value={documentFontPresets.serif}>세리프 본문</option><option value="custom">직접 입력</option></select></label>
      <label>AsciiDoc font-family<input value={documentDraft} maxLength={256} onChange={e => setDocumentDraft(e.target.value)} onBlur={() => commitFont('document')} /></label>
      <label>AsciiDoc 크기 {appearance.documentFontSize}px<input type="range" min="10" max="32" step="1" value={appearance.documentFontSize} onChange={e => updateAppearance({ ...appearance, documentFontSize: Number(e.target.value) })} /></label>
      {fontError && <p role="alert">{fontError}</p>}
    </fieldset>}
    {theme && <fieldset disabled={!workspace}><legend>AsciiDoc 미리보기 테마</legend>
      <label>내장 테마<select value={appearance.previewTheme} onChange={e => updateAppearance({ ...appearance, previewTheme: e.target.value as WorkspaceAppearanceV1['previewTheme'] })}><option value="default">기본</option><option value="dark">다크</option><option value="sepia">세피아</option></select></label>
      <label><input type="checkbox" checked={appearance.customCssEnabled} disabled={!stylesheet.name} onChange={e => updateAppearance({ ...appearance, customCssEnabled: e.target.checked })} />사용자 CSS를 내장 테마 위에 적용</label>
      <p>{stylesheet.name ? `연결된 CSS: ${stylesheet.name}` : '연결된 사용자 CSS가 없습니다.'}{stylesheet.warning && ` · ${stylesheet.warning}`}</p>
      <div className="tools"><button onClick={() => void selectStylesheet()}>CSS 파일 선택</button><button disabled={!stylesheet.name} onClick={() => void reloadStylesheet()}>다시 읽기</button><button disabled={!stylesheet.name} onClick={() => void clearStylesheet()}>CSS 연결 해제</button></div>
      <p>사용자 CSS는 현재 작업 공간의 미리보기 안에서만 적용됩니다. 외부 자원 URL과 @import는 차단됩니다.</p>
    </fieldset>}
    {!left && !right && !fonts && !theme && <p role="status">일치하는 보기 설정이 없습니다. 패널·너비·글꼴·테마·CSS로 검색하세요.</p>}
    <p role="status">{warning || '설정은 작업 공간별 로컬 설정에 저장됩니다.'}</p>
    <div className="tools"><button onClick={() => { setPrevious({ layout: structuredClone(value), appearance: structuredClone(appearance) }); update(structuredClone(defaultLayout)); updateAppearance({ ...structuredClone(defaultAppearance), customCssEnabled: false }); }}>보기 기본값 복원</button><button disabled={!previous} onClick={() => { if (previous) { update(previous.layout); updateAppearance(previous.appearance); } setPrevious(undefined); }}>초기화 이전 값 복원</button><button onClick={close}>닫기</button></div>
  </dialog>;
}

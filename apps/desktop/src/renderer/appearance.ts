import { useEffect, useState } from 'react';

export type PreviewTheme = 'default' | 'dark' | 'sepia';
export interface WorkspaceAppearanceV1 {
  version: 1;
  uiFontFamily: string;
  uiFontSize: number;
  documentFontFamily: string;
  documentFontSize: number;
  previewTheme: PreviewTheme;
  customCssEnabled: boolean;
}

export const uiFontPresets = {
  system: 'Inter, "Pretendard", "Segoe UI", sans-serif',
  native: 'system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif KR", serif'
} as const;
export const documentFontPresets = {
  code: '"Cascadia Code", Consolas, monospace',
  system: 'system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif KR", serif'
} as const;
export const defaultAppearance: WorkspaceAppearanceV1 = {
  version: 1,
  uiFontFamily: uiFontPresets.system,
  uiFontSize: 16,
  documentFontFamily: documentFontPresets.code,
  documentFontSize: 15,
  previewTheme: 'default',
  customCssEnabled: false
};
export const previewThemeStyles: Record<PreviewTheme, string> = {
  default: 'body{background:#fff;color:#233936}pre{background:#eef2ed}.admonitionblock{background:#fff6df;border-color:#92691b}td,th{border-color:#ccd7d2}a{color:#26755e}blockquote{border-color:#a3b8aa}',
  dark: 'body{background:#1e2422;color:#e5ece8}pre{background:#121715}.admonitionblock{background:#392f1d;border-color:#e0aa55}td,th{border-color:#59645f}a{color:#79c9ac}blockquote{border-color:#789087}',
  sepia: 'body{background:#f7f0df;color:#463c2c}pre{background:#eee3ca}.admonitionblock{background:#fff4cf;border-color:#9a6c28}td,th{border-color:#cbbd9d}a{color:#765a2d}blockquote{border-color:#aa9368}'
};
const themes = new Set<PreviewTheme>(['default', 'dark', 'sepia']);
export const clampUiFontSize = (value: number) => Math.max(12, Math.min(22, Math.round(value)));
export const clampDocumentFontSize = (value: number) => Math.max(10, Math.min(32, Math.round(value)));
export function validFontFamily(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim()
    && !/[\x00-\x1f;{}<>\\()[\]]/.test(value) && /^[\p{L}\p{N}\s,'"._-]+$/u.test(value);
}
export function normalizeAppearance(value: WorkspaceAppearanceV1): WorkspaceAppearanceV1 {
  return {
    version: 1,
    uiFontFamily: validFontFamily(value.uiFontFamily) ? value.uiFontFamily : defaultAppearance.uiFontFamily,
    uiFontSize: clampUiFontSize(value.uiFontSize),
    documentFontFamily: validFontFamily(value.documentFontFamily) ? value.documentFontFamily : defaultAppearance.documentFontFamily,
    documentFontSize: clampDocumentFontSize(value.documentFontSize),
    previewTheme: themes.has(value.previewTheme) ? value.previewTheme : defaultAppearance.previewTheme,
    customCssEnabled: !!value.customCssEnabled
  };
}
export function readAppearance(raw: string | null): WorkspaceAppearanceV1 {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value?.version === 1 && validFontFamily(value.uiFontFamily) && Number.isFinite(value.uiFontSize)
      && validFontFamily(value.documentFontFamily) && Number.isFinite(value.documentFontSize)
      && themes.has(value.previewTheme) && typeof value.customCssEnabled === 'boolean') return normalizeAppearance(value);
  } catch { /* default */ }
  return structuredClone(defaultAppearance);
}
export function useAppearance(workspaceKey?: string) {
  const key = workspaceKey ? `metis.appearance.v1.${workspaceKey}` : '';
  const load = () => key ? readAppearance(localStorage.getItem(key)) : structuredClone(defaultAppearance);
  const [stored, setStored] = useState(() => ({ key, value: load() }));
  const value = stored.key === key ? stored.value : load();
  const [warning, setWarning] = useState('');
  useEffect(() => { setStored({ key, value: load() }); setWarning(''); }, [key]);
  function update(next: WorkspaceAppearanceV1) {
    const normalized = normalizeAppearance(next); setStored({ key, value: normalized });
    if (!key) { setWarning('폰트와 테마를 저장하려면 작업 공간을 여세요.'); return; }
    try { localStorage.setItem(key, JSON.stringify(normalized)); setWarning(''); }
    catch { setWarning('글꼴과 테마 설정을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); }
  }
  return { value, warning, update, reset: () => update({ ...defaultAppearance, customCssEnabled: false }) };
}

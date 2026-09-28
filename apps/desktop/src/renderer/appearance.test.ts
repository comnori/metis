import { describe, expect, it } from 'vitest';
import { clampDocumentFontSize, clampUiFontSize, defaultAppearance, normalizeAppearance, previewThemeStyles, readAppearance, validFontFamily } from './appearance';

describe('workspace appearance v1', () => {
  it('uses defaults and clamps font sizes', () => {
    expect(readAppearance(null)).toEqual(defaultAppearance);
    expect(clampUiFontSize(4)).toBe(12); expect(clampUiFontSize(99)).toBe(22);
    expect(clampDocumentFontSize(4)).toBe(10); expect(clampDocumentFontSize(99)).toBe(32);
  });
  it('accepts font stacks and rejects CSS injection', () => {
    expect(validFontFamily('"Noto Sans KR", system-ui, sans-serif')).toBe(true);
    expect(validFontFamily('serif; color: red')).toBe(false);
    expect(validFontFamily('url(https://example.test/font)')).toBe(false);
  });
  it('recovers malformed settings and normalizes values', () => {
    expect(readAppearance('{bad')).toEqual(defaultAppearance);
    expect(normalizeAppearance({ ...defaultAppearance, uiFontSize: 30, documentFontSize: 1, previewTheme: 'broken' as never })).toMatchObject({ uiFontSize: 22, documentFontSize: 10, previewTheme: 'default' });
  });
  it('provides distinct built-in preview themes', () => {
    expect(Object.keys(previewThemeStyles)).toEqual(['default', 'dark', 'sepia']);
    expect(new Set(Object.values(previewThemeStyles)).size).toBe(3);
    expect(previewThemeStyles.dark).toContain('#1e2422'); expect(previewThemeStyles.sepia).toContain('#f7f0df');
  });
});

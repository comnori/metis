import { describe, expect, it } from 'vitest';
import { clampLeft, clampRight, defaultLayout, readLayout } from './layout';

describe('workspace layout v2', () => {
  it('uses the Obsidian-style initial panel state', () => {
    expect(readLayout(null)).toEqual(defaultLayout);
    expect(defaultLayout.left).toMatchObject({ open: true, active: 'files' });
    expect(defaultLayout.right).toMatchObject({ open: false, active: 'outline' });
  });

  it('migrates a v1 layout and clamps both panel widths', () => {
    const migrated = readLayout(null, JSON.stringify({ files: false, outline: true, fileWidth: 999, outlineWidth: 10 }));
    expect(migrated).toEqual({ version: 2, left: { open: false, active: 'files', width: 420 }, right: { open: true, active: 'outline', width: 220 } });
  });

  it('recovers malformed values and normalizes stored v2 widths', () => {
    expect(readLayout('{bad json')).toEqual(defaultLayout);
    const value = readLayout(JSON.stringify({ version: 2, left: { open: true, active: 'search', width: 100 }, right: { open: false, active: 'diagnostics', width: 800 } }));
    expect(value.left.width).toBe(180);
    expect(value.right.width).toBe(420);
    expect(clampLeft(235.4)).toBe(235);
    expect(clampRight(311.8)).toBe(312);
  });
});

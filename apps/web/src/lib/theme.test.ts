import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP, normalizeTheme } from './theme';

describe('normalizeTheme', () => {
  it.each([
    [null, 'dark'],
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'system'],
    ['night', 'dark'],
    ['soft', 'light'],
    ['garbage', 'dark'],
  ] as const)('%s -> %s', (stored, theme) => {
    expect(normalizeTheme(stored)).toBe(theme);
  });
});

describe('THEME_BOOTSTRAP', () => {
  it('maps the old names the same way before React loads', () => {
    expect(THEME_BOOTSTRAP).toContain("s === 'light' || s === 'soft'");
    expect(THEME_BOOTSTRAP).toContain("s === 'system'");
  });
});

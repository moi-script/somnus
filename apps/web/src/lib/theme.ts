export type Theme = 'dark' | 'light' | 'system';

const KEY = 'lacs.theme';

/**
 * Dark is the default since 0.6. Choices made before then carry over:
 * "night" was the dark one, "soft" the light one.
 */
export function normalizeTheme(stored: string | null): Theme {
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  if (stored === 'night') return 'dark';
  if (stored === 'soft') return 'light';
  return 'dark';
}

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return normalizeTheme(window.localStorage.getItem(KEY));
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setTheme(theme: Theme): void {
  window.localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/**
 * Runs before React hydrates, so the page never paints in the wrong theme.
 * Inlined into the document head as a plain string; keep it in step with
 * normalizeTheme.
 */
export const THEME_BOOTSTRAP = `
(function () {
  try {
    var s = localStorage.getItem('${KEY}');
    var t = s === 'light' || s === 'soft' ? 'light' : s === 'system' ? 'system' : 'dark';
    var dark = t === 'dark' ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

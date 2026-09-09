export type Theme = 'soft' | 'night' | 'system';

const KEY = 'lacs.theme';

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(KEY);
  return stored === 'soft' || stored === 'night' ? stored : 'system';
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'night' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setTheme(theme: Theme): void {
  window.localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/**
 * Runs before React hydrates, so the page never paints light and then flips.
 * Inlined into the document head as a plain string.
 */
export const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem('${KEY}');
    var dark = stored === 'night' ||
      ((!stored || stored === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {}
})();
`;

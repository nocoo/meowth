export const THEME_STORAGE_KEY = 'meowth_theme';

export function applyStoredTheme(
  root: HTMLElement = document.documentElement,
  storage?: Pick<Storage, 'getItem'>,
  media?: Pick<MediaQueryList, 'matches'>,
): void {
  let stored: string | null = null;
  try {
    const store = storage ?? globalThis.localStorage;
    stored = store?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  let prefersDark = false;
  try {
    prefersDark =
      (media ?? globalThis.matchMedia?.('(prefers-color-scheme: dark)'))?.matches ?? false;
  } catch {
    prefersDark = false;
  }
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.setAttribute('data-mode', isDark ? 'dark' : 'light');
}

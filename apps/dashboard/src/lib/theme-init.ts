export const THEME_STORAGE_KEY = 'meowth_theme';

export function applyStoredTheme(
  root: HTMLElement = document.documentElement,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
  media: Pick<MediaQueryList, 'matches'> | undefined = globalThis.matchMedia?.(
    '(prefers-color-scheme: dark)',
  ),
): void {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  const prefersDark = media?.matches ?? false;
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.setAttribute('data-mode', isDark ? 'dark' : 'light');
}

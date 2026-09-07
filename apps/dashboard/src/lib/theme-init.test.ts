import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, applyStoredTheme } from './theme-init';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
  delete document.documentElement.dataset.mode;
});

describe('applyStoredTheme', () => {
  it('applies stored dark without reading system preference', () => {
    const storage = { getItem: () => 'dark' };
    const media = { matches: false };
    applyStoredTheme(document.documentElement, storage, media);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('applies stored light even when the system prefers dark', () => {
    const storage = { getItem: () => 'light' };
    const media = { matches: true };
    applyStoredTheme(document.documentElement, storage, media);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('falls back to system preference when the key is missing', () => {
    const storage = { getItem: () => null };
    applyStoredTheme(document.documentElement, storage, { matches: true });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses THEME_STORAGE_KEY meowth_theme', () => {
    expect(THEME_STORAGE_KEY).toBe('meowth_theme');
  });
});

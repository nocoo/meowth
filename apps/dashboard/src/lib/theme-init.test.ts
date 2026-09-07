import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, applyStoredTheme } from './theme-init';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-mode');
});

describe('applyStoredTheme', () => {
  it('applies stored dark without reading system preference', () => {
    const storage = { getItem: () => 'dark' };
    const media = { matches: false };
    applyStoredTheme(document.documentElement, storage, media);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });

  it('applies stored light even when the system prefers dark', () => {
    const storage = { getItem: () => 'light' };
    const media = { matches: true };
    applyStoredTheme(document.documentElement, storage, media);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
  });

  it('falls back to system preference when the key is missing', () => {
    const storage = { getItem: () => null };
    applyStoredTheme(document.documentElement, storage, { matches: true });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses THEME_STORAGE_KEY meowth_theme', () => {
    expect(THEME_STORAGE_KEY).toBe('meowth_theme');
  });

  it('treats a throwing storage read as missing', () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
    };
    applyStoredTheme(document.documentElement, storage, { matches: true });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('treats missing matchMedia as light', () => {
    applyStoredTheme(document.documentElement, { getItem: () => null }, undefined);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
  });

  it('treats a throwing localStorage getter as missing', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      applyStoredTheme(document.documentElement, undefined, { matches: true });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });
});

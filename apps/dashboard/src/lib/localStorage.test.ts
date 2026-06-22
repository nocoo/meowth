import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStoredToken, getStoredToken, setStoredToken } from './localStorage';

const KEY = 'meowth_token';
const THEME_KEY = 'meowth_theme';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('localStorage token wrapper — happy path', () => {
  it('returns null when no token has been stored', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('round-trips set + get', () => {
    setStoredToken('mwt_example_value');
    expect(getStoredToken()).toBe('mwt_example_value');
  });

  it('clearStoredToken removes the token', () => {
    setStoredToken('mwt_example_value');
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });

  it('writes to the meowth_token key, not anything else', () => {
    setStoredToken('mwt_xyz');
    expect(window.localStorage.getItem(KEY)).toBe('mwt_xyz');
  });

  it('does not touch the meowth_theme key', () => {
    window.localStorage.setItem(THEME_KEY, 'dark');
    setStoredToken('mwt_xyz');
    clearStoredToken();
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });
});

describe('localStorage token wrapper — failure resilience', () => {
  function installFailingStorage(method: 'getItem' | 'setItem' | 'removeItem'): () => void {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        get length(): number {
          return 0;
        },
        clear: () => {
          // not exercised
        },
        key: () => null,
        getItem(): string | null {
          if (method === 'getItem') throw new Error('boom');
          return null;
        },
        setItem(): void {
          if (method === 'setItem') throw new Error('boom');
        },
        removeItem(): void {
          if (method === 'removeItem') throw new Error('boom');
        },
      },
    });
    return () => {
      if (original) Object.defineProperty(window, 'localStorage', original);
    };
  }

  it('returns null when getItem throws', () => {
    const restore = installFailingStorage('getItem');
    try {
      expect(getStoredToken()).toBeNull();
    } finally {
      restore();
    }
  });

  it('does not throw when setItem throws (quota / private mode)', () => {
    const restore = installFailingStorage('setItem');
    try {
      expect(() => setStoredToken('mwt_x')).not.toThrow();
    } finally {
      restore();
    }
  });

  it('does not throw when removeItem throws', () => {
    const restore = installFailingStorage('removeItem');
    try {
      expect(() => clearStoredToken()).not.toThrow();
    } finally {
      restore();
    }
  });
});

// Vitest setup.
//
// 1) Bind jest-dom matchers to Vitest's expect (reviewer correction #2).
import '@testing-library/jest-dom/vitest';

// 2) Guarantee a usable Storage on `window.localStorage` / `sessionStorage`.
//    Node 22+ ships an experimental top-level `localStorage` that requires
//    `--localstorage-file`; on Node 26 it shadows jsdom's Storage and surfaces
//    as `window.localStorage === undefined`, breaking every component that
//    persists to it. We install a tiny in-memory Storage shim once, before
//    any test runs, so storage behavior is deterministic regardless of host
//    Node version or jsdom build.

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
  };
}

function ensureStorage(
  target: Window & typeof globalThis,
  name: 'localStorage' | 'sessionStorage',
): void {
  let usable = false;
  try {
    const candidate = (target as unknown as Record<string, unknown>)[name];
    usable =
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as Storage).getItem === 'function' &&
      typeof (candidate as Storage).setItem === 'function' &&
      typeof (candidate as Storage).clear === 'function';
  } catch {
    usable = false;
  }
  if (usable) return;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

ensureStorage(window as Window & typeof globalThis, 'localStorage');
ensureStorage(window as Window & typeof globalThis, 'sessionStorage');

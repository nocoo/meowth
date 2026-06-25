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

// 3) Minimal ResizeObserver / matchMedia shims for jsdom so radix-ui
//    primitives (Tooltip, Select, Sheet etc.) can mount under test.
//    jsdom does not implement either by default; the real browser
//    behavior is exercised in L3 Playwright, so a no-op stub is enough
//    here.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverShim,
  });
}

if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// jsdom does not implement Element.prototype.scrollIntoView; radix-ui
// Select calls it on focused items when the listbox opens. A no-op
// keeps the open path under L1.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoViewShim(): void {};
}

// jsdom's PointerEvent / hasPointerCapture stubs are also missing from
// some Node 26 + jsdom 26 builds; radix-ui Select reaches for them when
// the trigger is activated. No-ops are sufficient for L1 mount tests.
if (typeof HTMLElement !== 'undefined') {
  if (typeof HTMLElement.prototype.hasPointerCapture !== 'function') {
    HTMLElement.prototype.hasPointerCapture = function hasPointerCaptureShim(): boolean {
      return false;
    };
  }
  if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
    HTMLElement.prototype.releasePointerCapture = function releasePointerCaptureShim(): void {};
  }
}

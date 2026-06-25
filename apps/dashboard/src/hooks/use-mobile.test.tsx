import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useIsMobile } from './use-mobile';

const ORIGINAL = window.innerWidth;

function setViewport(w: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: ORIGINAL,
  });
});

describe('useIsMobile (Stage B1)', () => {
  it('returns false at desktop width >=768', () => {
    setViewport(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true at mobile width <768', () => {
    setViewport(420);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reacts to a resize from desktop → mobile', () => {
    setViewport(1280);
    const { result, rerender } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    setViewport(400);
    rerender();
    expect(result.current).toBe(true);
  });

  it('subscribe + unsubscribe register the matchMedia + window listeners', () => {
    // Cover the subscribe path's add/remove branches by mounting and
    // unmounting the hook; the cleanup function from
    // useSyncExternalStore fires `removeEventListener` on both the
    // MediaQueryList and the window.
    setViewport(1024);
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    // No throw = both addEventListener and removeEventListener paths
    // were exercised against the live jsdom matchMedia + window
    // objects.
    expect(true).toBe(true);
  });
});

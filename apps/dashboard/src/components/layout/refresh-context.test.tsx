import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RefreshProvider, useRefresh } from './refresh-context';

describe('RefreshProvider / useRefresh', () => {
  it('default state: no handler, not pending', () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    expect(result.current.handler).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it('register() installs the handler and returns an unregister fn', () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    const fn = vi.fn();
    let unregister = (): void => undefined;
    act(() => {
      unregister = result.current.register(fn);
    });
    expect(result.current.handler).toBe(fn);
    act(() => unregister());
    expect(result.current.handler).toBeNull();
  });

  it('a fresh register() replaces the prior handler', () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    const a = vi.fn();
    const b = vi.fn();
    act(() => {
      result.current.register(a);
    });
    act(() => {
      result.current.register(b);
    });
    expect(result.current.handler).toBe(b);
  });

  it('a stale unregister does NOT clear a newer handler', () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    const a = vi.fn();
    const b = vi.fn();
    let unregisterA = (): void => undefined;
    act(() => {
      unregisterA = result.current.register(a);
    });
    act(() => {
      result.current.register(b);
    });
    // Page A unmounts AFTER Page B has registered (the StrictMode
    // / route-change race the production unregister guards against).
    act(() => unregisterA());
    expect(result.current.handler).toBe(b);
  });

  it('trigger() awaits async handler and surfaces pending', async () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    let resolveHandler: () => void = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    );
    act(() => {
      result.current.register(handler);
    });
    let pendingTrigger: Promise<void> = Promise.resolve();
    act(() => {
      pendingTrigger = result.current.trigger();
    });
    expect(result.current.pending).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveHandler();
      await pendingTrigger;
    });
    expect(result.current.pending).toBe(false);
  });

  it('trigger() with no handler is a no-op', async () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.pending).toBe(false);
  });

  it('concurrent trigger() calls are dropped while pending', async () => {
    const { result } = renderHook(() => useRefresh(), {
      wrapper: ({ children }) => <RefreshProvider>{children}</RefreshProvider>,
    });
    let resolveHandler: () => void = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    );
    act(() => {
      result.current.register(handler);
    });
    let firstTrigger: Promise<void> = Promise.resolve();
    act(() => {
      firstTrigger = result.current.trigger();
    });
    // Second click while the first is still in flight should not
    // call the handler again.
    await act(async () => {
      await result.current.trigger();
    });
    expect(handler).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveHandler();
      await firstTrigger;
    });
  });

  it('useRefresh throws outside a provider', () => {
    function BareConsumer() {
      useRefresh();
      return <div />;
    }
    expect(() => render(<BareConsumer />)).toThrow(
      'useRefresh must be used within a RefreshProvider',
    );
    expect(screen).toBeDefined();
  });
});

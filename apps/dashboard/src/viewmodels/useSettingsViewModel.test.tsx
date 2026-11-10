import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSettingsViewModel from './useSettingsViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/settings']}>{children}</MemoryRouter>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useSettingsViewModel', () => {
  it('reports daemonReachable=true when healthz succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { result } = renderHook(() => useSettingsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.daemonReachable).toBe(true);
    }
  });

  it('reports daemonReachable=false on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSettingsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.daemonReachable).toBe(false);
    }
  });

  it('exposes a version string (defaults to "dev")', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { result } = renderHook(() => useSettingsViewModel(), { wrapper });
    expect(typeof result.current.version).toBe('string');
    expect(result.current.version.length).toBeGreaterThan(0);
  });

  it('ignores late healthz success after unmount', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => pending);
    const { unmount } = renderHook(() => useSettingsViewModel(), { wrapper });
    unmount();
    resolveFetch?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await Promise.resolve();
  });

  it('ignores rejected healthz fetch after unmount', async () => {
    let rejectFetch: ((error: unknown) => void) | undefined;
    const pending = new Promise<Response>((_, reject) => {
      rejectFetch = reject;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => pending);
    const { unmount } = renderHook(() => useSettingsViewModel(), { wrapper });
    unmount();
    rejectFetch?.(new TypeError('Failed to fetch'));
    await Promise.resolve();
  });

  it('does not surface an error when healthz returns 401', async () => {
    window.localStorage.setItem('meowth_token', 'mwt_something');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    const { result } = renderHook(() => useSettingsViewModel(), { wrapper });
    await waitFor(() => expect(window.localStorage.getItem('meowth_token')).toBeNull());
    expect(result.current.status.kind).toBe('loading');
  });

  it('refresh re-probes healthz', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderHook(() => useSettingsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    const before = spy.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });
});

import { renderHook, waitFor } from '@testing-library/react';
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
});

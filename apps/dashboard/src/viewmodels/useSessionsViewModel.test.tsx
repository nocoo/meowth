import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSessionsViewModel from './useSessionsViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/sessions']}>{children}</MemoryRouter>;
}

const TOKEN_KEY = 'meowth_token';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useSessionsViewModel', () => {
  it('happy path: loading -> ready', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    );
    const { result } = renderHook(() => useSessionsViewModel(), { wrapper });
    expect(result.current.status.kind).toBe('loading');
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
  });

  it('on 401 clears stored token and does not surface an error message', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'mwt_something');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    const { result } = renderHook(() => useSessionsViewModel(), { wrapper });
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
    expect(result.current.status.kind).toBe('loading');
  });

  it('on network rejection keeps token and surfaces daemon-unreachable', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'mwt_something');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSessionsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('mwt_something');
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/unreachable/i);
    }
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useOverviewViewModel from './useOverviewViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/overview']}>{children}</MemoryRouter>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mockResponses(): void {
  let i = 0;
  // 4 calls: healthz, listTokens, listSessions, fetchAgents
  const bodies = [
    JSON.stringify({ ok: true }),
    JSON.stringify({ tokens: [] }),
    JSON.stringify({ sessions: [] }),
    JSON.stringify({
      agents: [{ type: 'claude', installed: true, executable: '/x', version: 'v1' }],
    }),
  ];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const body = bodies[i++ % bodies.length];
    return new Response(body, { status: 200 });
  });
}

describe('useOverviewViewModel', () => {
  it('starts in loading then transitions to ready with the merged data', async () => {
    mockResponses();
    const { result } = renderHook(() => useOverviewViewModel(), { wrapper });
    expect(result.current.status.kind).toBe('loading');
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.data.tokens).toEqual([]);
      expect(result.current.status.data.sessions).toEqual([]);
      expect(result.current.status.data.agents.length).toBe(1);
    }
  });

  it('surfaces a non-401 ApiError as error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ type: '/problems/bad', title: 'Bad', status: 500 }), {
        status: 500,
      }),
    );
    const { result } = renderHook(() => useOverviewViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
  });

  it('includes null health when healthz fails while other data loads', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      call += 1;
      const url = String(input);
      if (call === 1 || url.includes('healthz')) {
        return new Response('', { status: 503 });
      }
      if (url.includes('tokens')) {
        return new Response(JSON.stringify({ tokens: [{ id: 't1' }] }), { status: 200 });
      }
      if (url.includes('sessions')) {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    });
    const { result } = renderHook(() => useOverviewViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.data.health).toBeNull();
    }
  });

  it('does not update state after unmount while requests are in flight', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => pending);
    const { unmount } = renderHook(() => useOverviewViewModel(), { wrapper });
    unmount();
    resolveFetch?.(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
    await Promise.resolve();
  });

  it('stays loading when listTokens returns 401', async () => {
    window.localStorage.setItem('meowth_token', 'mwt_something');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    const { result } = renderHook(() => useOverviewViewModel(), { wrapper });
    await waitFor(() => expect(window.localStorage.getItem('meowth_token')).toBeNull());
    expect(result.current.status.kind).toBe('loading');
  });

  it('refresh re-runs the fetches', async () => {
    mockResponses();
    const spy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useOverviewViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    const before = spy.mock.calls.length;
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });
});

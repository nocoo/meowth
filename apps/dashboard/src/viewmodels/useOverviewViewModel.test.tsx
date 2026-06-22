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

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAgentsViewModel from './useAgentsViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/agents']}>{children}</MemoryRouter>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useAgentsViewModel', () => {
  it('starts loading then transitions to ready', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          agents: [{ type: 'claude', installed: true, executable: '/x', version: 'v1' }],
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useAgentsViewModel(), { wrapper });
    expect(result.current.status.kind).toBe('loading');
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.agents.length).toBe(1);
    }
  });

  it('surfaces problem.title on non-401 ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ type: '/problems/x', title: 'Backend broken', status: 500 }), {
        status: 500,
      }),
    );
    const { result } = renderHook(() => useAgentsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toBe('Backend broken');
    }
  });

  it('falls back to Daemon unreachable on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAgentsViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/unreachable/i);
    }
  });
});

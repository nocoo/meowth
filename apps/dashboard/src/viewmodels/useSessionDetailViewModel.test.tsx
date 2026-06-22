import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSessionDetailViewModel from './useSessionDetailViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/sessions/sid']}>{children}</MemoryRouter>;
}

const SID = 'sid';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function envelope(seq: number, type: string, payload: Record<string, unknown>) {
  return {
    v: 1,
    seq,
    ts: `2026-06-22T00:00:0${seq}Z`,
    session_id: SID,
    type,
    payload,
  };
}

describe('useSessionDetailViewModel', () => {
  it('loads session + first snapshot page when has_more=false', async () => {
    const session = {
      id: SID,
      backend_type: 'claude',
      backend_session_id: 'bs',
      status: 'completed',
      started_at: '2026-06-22T00:00:00Z',
      ended_at: '2026-06-22T00:00:10Z',
      thread_name: '',
      model: 'opus',
    };
    const page = {
      session_id: SID,
      events: [envelope(1, 'message', { content: 'hello' })],
      next_after_seq: 1,
      has_more: false,
    };
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      const body = call === 1 ? JSON.stringify(session) : JSON.stringify(page);
      return new Response(body, { status: 200 });
    });
    const { result } = renderHook(() => useSessionDetailViewModel(SID), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    if (result.current.status.kind === 'ready') {
      expect(result.current.status.messages.length).toBe(1);
    }
  });

  it('stops with error when has_more is true but next_after_seq does not advance', async () => {
    const session = {
      id: SID,
      backend_type: 'claude',
      backend_session_id: 'bs',
      status: 'running',
      started_at: '2026-06-22T00:00:00Z',
      ended_at: null,
      thread_name: '',
      model: 'opus',
    };
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify(session), { status: 200 });
      // Every page claims has_more but never advances next_after_seq.
      return new Response(
        JSON.stringify({
          session_id: SID,
          events: [envelope(1, 'message', { content: 'a' })],
          next_after_seq: 0,
          has_more: true,
        }),
        { status: 200 },
      );
    });
    const { result } = renderHook(() => useSessionDetailViewModel(SID), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/non-advancing/i);
    }
  });

  it('reports an error message when sessionId is missing', () => {
    const { result } = renderHook(() => useSessionDetailViewModel(''), { wrapper });
    expect(result.current.status.kind).toBe('error');
  });
});

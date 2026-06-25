import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionDetailPage from './SessionDetailPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// SessionsListPage tests moved to SessionsListPage.test.tsx in
// Phase 2 Stage C3a (vm-mocked shell + props-driven Content +
// table-shaped Skeleton). SessionDetailPage tests remain here
// until Stage C3b splits the detail page.

describe('SessionDetailPage', () => {
  function envelope(seq: number, type: string, payload: Record<string, unknown>) {
    return {
      v: 1,
      seq,
      ts: `2026-06-22T00:00:0${seq}Z`,
      session_id: 'sid',
      type,
      payload,
    };
  }

  it('threads :id through useSessionDetailViewModel and renders messages', async () => {
    const session = {
      id: 'sid',
      backend_type: 'claude',
      backend_session_id: 'bs',
      status: 'completed',
      started_at: '2026-06-22T00:00:00Z',
      ended_at: '2026-06-22T00:00:10Z',
      thread_name: '',
      model: 'opus',
    };
    const page = {
      session_id: 'sid',
      events: [
        envelope(1, 'session_started', { backend: 'claude' }),
        envelope(2, 'message', { content: 'hello world' }),
        envelope(3, 'heartbeat', {}),
        envelope(4, 'session_ended', { reason: 'completed' }),
      ],
      next_after_seq: 4,
      has_more: false,
    };
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      const body = call === 1 ? JSON.stringify(session) : JSON.stringify(page);
      return new Response(body, { status: 200 });
    });
    const router = createMemoryRouter([{ path: '/sessions/:id', element: <SessionDetailPage /> }], {
      initialEntries: ['/sessions/sid'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Session' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
    expect(screen.getByTestId('session-detail-id').textContent).toBe('sid');
    // heartbeat must NOT render any visible row.
    expect(screen.queryByTestId('status-row-heartbeat')).toBeNull();
    // session_ended must render as a status row.
    expect(screen.getByTestId('status-row-session_ended')).toBeInTheDocument();
  });

  it('renders payload.output through MessageText when payload.content is absent', async () => {
    const session = {
      id: 'sid',
      backend_type: 'claude',
      backend_session_id: 'bs',
      status: 'completed',
      started_at: '2026-06-22T00:00:00Z',
      ended_at: '2026-06-22T00:00:01Z',
      thread_name: '',
      model: 'opus',
    };
    const page = {
      session_id: 'sid',
      events: [envelope(0, 'message', { output: 'tool result text' })],
      next_after_seq: 0,
      has_more: false,
    };
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      return new Response(call === 1 ? JSON.stringify(session) : JSON.stringify(page), {
        status: 200,
      });
    });
    const router = createMemoryRouter([{ path: '/sessions/:id', element: <SessionDetailPage /> }], {
      initialEntries: ['/sessions/sid'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText('tool result text')).toBeInTheDocument());
  });
});

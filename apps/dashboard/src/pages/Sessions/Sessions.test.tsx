import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionDetailPage from './SessionDetailPage';
import SessionsListPage from './SessionsListPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('SessionsListPage', () => {
  it('renders the empty placeholder when there are no sessions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    );
    const router = createMemoryRouter([{ path: '/sessions', element: <SessionsListPage /> }], {
      initialEntries: ['/sessions'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Sessions' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No sessions yet.')).toBeInTheDocument());
  });

  it('renders one row per session with a link to the detail page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: 'sid-1',
              backend_type: 'claude',
              backend_session_id: 'bs',
              status: 'completed',
              started_at: '2026-06-22T00:00:00Z',
              ended_at: '2026-06-22T00:01:00Z',
              thread_name: 't',
              model: 'opus',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const router = createMemoryRouter([{ path: '/sessions', element: <SessionsListPage /> }], {
      initialEntries: ['/sessions'],
    });
    render(<RouterProvider router={router} />);
    const link = await screen.findByRole('link', { name: 'claude' });
    expect(link.getAttribute('href')).toBe('/sessions/sid-1');
  });
});

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
});

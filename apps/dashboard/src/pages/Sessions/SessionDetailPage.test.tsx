import type { SessionDetailViewModel } from '@/viewmodels/useSessionDetailViewModel';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionDetailPage from './SessionDetailPage';

// Page shell tests for Phase 2 Stage C3b. Mocks
// `useSessionDetailViewModel` directly so the test does not
// depend on fetch ordering. Envelope/header rendering belongs to
// SessionDetailContent.test.tsx.

const { mockUseDetail } = vi.hoisted(() => ({ mockUseDetail: vi.fn() }));

vi.mock('@/viewmodels/useSessionDetailViewModel', () => ({
  default: (sessionId: string) => mockUseDetail(sessionId) as SessionDetailViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseDetail.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vmFor(
  sessionId: string,
  status: SessionDetailViewModel['status'],
): SessionDetailViewModel {
  return {
    sessionId,
    status,
    refresh: () => {
      /* noop */
    },
  };
}

function renderShellAt(path = '/sessions/sid-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SessionDetailPage (shell, Stage C3b)', () => {
  it('always renders the Session heading', () => {
    mockUseDetail.mockImplementation((sid: string) => vmFor(sid, { kind: 'loading' }));
    renderShellAt();
    expect(screen.getByRole('heading', { level: 2, name: 'Session' })).toBeInTheDocument();
  });

  it('loading branch renders the SessionDetailSkeleton (no content yet)', () => {
    mockUseDetail.mockImplementation((sid: string) => vmFor(sid, { kind: 'loading' }));
    const { container } = renderShellAt();
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('session-messages')).toBeNull();
  });

  it('error branch keeps the session-detail-id row and shows EmptyState', () => {
    mockUseDetail.mockImplementation((sid: string) =>
      vmFor(sid, { kind: 'error', message: 'detail-boom' }),
    );
    renderShellAt('/sessions/sid-err');
    const idRow = screen.getByTestId('session-detail-id');
    expect(idRow.textContent).toBe('sid-err');
    expect(screen.getByText('Session unavailable')).toBeInTheDocument();
    expect(screen.getByText('detail-boom')).toBeInTheDocument();
  });

  it('ready branch hands session + messages to SessionDetailContent', () => {
    mockUseDetail.mockImplementation((sid: string) =>
      vmFor(sid, {
        kind: 'ready',
        session: {
          id: sid,
          backend_type: 'claude',
          backend_session_id: 'bs',
          status: 'completed',
          started_at: '2026-06-22T00:00:00Z',
          ended_at: '2026-06-22T00:01:00Z',
          thread_name: '',
          model: 'opus',
        },
        messages: [
          {
            v: 1,
            seq: 1,
            ts: '2026-06-22T00:00:01Z',
            session_id: sid,
            type: 'message',
            payload: { content: 'hi from c3b' },
          },
        ],
      }),
    );
    renderShellAt('/sessions/sid-ok');
    expect(screen.getByTestId('session-detail-id').textContent).toBe('sid-ok');
    expect(screen.getByTestId('session-messages')).toBeInTheDocument();
    expect(screen.getByText('hi from c3b')).toBeInTheDocument();
  });
});

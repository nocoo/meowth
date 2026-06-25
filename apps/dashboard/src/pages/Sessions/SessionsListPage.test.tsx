import type { SessionsViewModel } from '@/viewmodels/useSessionsViewModel';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsListPage from './SessionsListPage';

// Page shell tests for Phase 2 Stage C3a. Mocks
// `useSessionsViewModel` directly so the test does not depend on
// fetch ordering. Content rendering (table cells, EmptyState) is
// covered separately by SessionsListContent.test.tsx.

const { mockUseSessions } = vi.hoisted(() => ({ mockUseSessions: vi.fn() }));

vi.mock('@/viewmodels/useSessionsViewModel', () => ({
  default: () => mockUseSessions() as SessionsViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseSessions.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vm(status: SessionsViewModel['status']): SessionsViewModel {
  return {
    status,
    refresh: () => {
      /* noop */
    },
  };
}

function renderShell() {
  return render(
    <MemoryRouter>
      <SessionsListPage />
    </MemoryRouter>,
  );
}

describe('SessionsListPage (shell, Stage C3a)', () => {
  it('always renders the Sessions heading', () => {
    mockUseSessions.mockReturnValue(vm({ kind: 'loading' }));
    renderShell();
    expect(screen.getByRole('heading', { level: 2, name: 'Sessions' })).toBeInTheDocument();
  });

  it('loading branch shows the SessionsListSkeleton (5 row × 5 col placeholders)', () => {
    mockUseSessions.mockReturnValue(vm({ kind: 'loading' }));
    const { container } = renderShell();
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(5 * 5);
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
  });

  it('error branch routes to EmptyState (tone="error") with the vm message', () => {
    mockUseSessions.mockReturnValue(vm({ kind: 'error', message: 'sessions-boom' }));
    renderShell();
    expect(screen.getByText('Sessions unavailable')).toBeInTheDocument();
    expect(screen.getByText('sessions-boom')).toBeInTheDocument();
  });

  it('ready branch hands the sessions list to SessionsListContent', () => {
    mockUseSessions.mockReturnValue(
      vm({
        kind: 'ready',
        sessions: [
          {
            id: 'sid-1',
            backend_type: 'claude',
            backend_session_id: 'bsid-1',
            status: 'completed',
            started_at: '2026-06-01T00:00:00Z',
            ended_at: '2026-06-01T00:01:00Z',
            thread_name: 't-1',
            model: 'claude-sonnet-4-6',
          },
        ],
      }),
    );
    renderShell();
    const link = screen.getByRole('link', { name: 'claude' });
    expect(link.getAttribute('href')).toBe('/sessions/sid-1');
  });
});

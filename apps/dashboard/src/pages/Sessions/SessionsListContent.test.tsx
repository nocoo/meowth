import type { Session } from '@/models/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import SessionsListContent from './SessionsListContent';

// Pure-props Content tests for Phase 2 Stage C3a.

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    backend_type: 'claude',
    backend_session_id: `bsid-${id}`,
    status: 'completed',
    started_at: '2026-06-01T00:00:00Z',
    ended_at: '2026-06-01T00:01:00Z',
    thread_name: `t-${id}`,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function renderContent(sessions: Session[]) {
  return render(
    <MemoryRouter>
      <SessionsListContent sessions={sessions} />
    </MemoryRouter>,
  );
}

describe('SessionsListContent (props, Stage C3a)', () => {
  it('renders the 5-column header when sessions are present', () => {
    renderContent([makeSession('a')]);
    for (const label of ['Backend', 'Status', 'Model', 'Started', 'Thread']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('renders a row per session with the Backend cell as a /sessions/<id> link', () => {
    renderContent([
      makeSession('sid-1', { backend_type: 'claude' }),
      makeSession('sid-2', { backend_type: 'codex' }),
    ]);
    const link1 = screen.getByRole('link', { name: 'claude' });
    const link2 = screen.getByRole('link', { name: 'codex' });
    expect(link1.getAttribute('href')).toBe('/sessions/sid-1');
    expect(link2.getAttribute('href')).toBe('/sessions/sid-2');
  });

  it('shows an EmptyState (not the table) when sessions list is empty', () => {
    renderContent([]);
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Backend' })).not.toBeInTheDocument();
  });

  it('wraps the populated table in a rounded-card bg-secondary L2 surface', () => {
    const { container } = renderContent([makeSession('sid-x')]);
    const wrap = container.querySelector('.rounded-card.bg-secondary');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-slot="table-container"]')).not.toBeNull();
  });
});

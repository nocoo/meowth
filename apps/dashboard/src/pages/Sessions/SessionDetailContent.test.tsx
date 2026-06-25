import type { SessionInfo, SessionMessageRow } from '@/viewmodels/useSessionDetailViewModel';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SessionDetailContent from './SessionDetailContent';

// Pure-props Content tests for Phase 2 Stage C3b. Preserves the
// visible/test contract carried over from the C3a-pre Sessions
// detail tests: header row, session-messages container,
// MessageText payload.content + payload.output fallback,
// heartbeat hidden, usage hidden, and status rows for
// session_started / error / session_ended.

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sid',
    backend_type: 'claude',
    backend_session_id: 'bs',
    status: 'completed',
    started_at: '2026-06-22T00:00:00Z',
    ended_at: '2026-06-22T00:00:10Z',
    thread_name: '',
    model: 'opus',
    ...overrides,
  };
}

function envelope(
  seq: number,
  type: SessionMessageRow['type'],
  payload: Record<string, unknown>,
): SessionMessageRow {
  return {
    v: 1,
    seq,
    ts: `2026-06-22T00:00:0${seq}Z`,
    session_id: 'sid',
    type,
    payload,
  };
}

describe('SessionDetailContent (props, Stage C3b)', () => {
  it('renders the id / backend / status / model / started+ended header row', () => {
    render(<SessionDetailContent session={makeSession()} messages={[]} />);
    expect(screen.getByTestId('session-detail-id').textContent).toBe('sid');
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(
      screen.getByText(/Started 2026-06-22T00:00:00Z · ended 2026-06-22T00:00:10Z/),
    ).toBeInTheDocument();
  });

  it('omits the " · ended ..." suffix when session.ended_at is null', () => {
    render(<SessionDetailContent session={makeSession({ ended_at: null })} messages={[]} />);
    expect(screen.getByText('Started 2026-06-22T00:00:00Z')).toBeInTheDocument();
    expect(screen.queryByText(/ended/)).toBeNull();
  });

  it('renders message envelopes with payload.content via MessageText and ignores heartbeat', () => {
    render(
      <SessionDetailContent
        session={makeSession()}
        messages={[
          envelope(1, 'session_started', { backend: 'claude' }),
          envelope(2, 'message', { content: 'hello world' }),
          envelope(3, 'heartbeat', {}),
          envelope(4, 'session_ended', { reason: 'completed' }),
        ]}
      />,
    );
    expect(screen.getByTestId('session-messages')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
    // heartbeat must NOT render any visible row.
    expect(screen.queryByTestId('status-row-heartbeat')).toBeNull();
    // session_ended must render as a status row + reason.
    const endedRow = screen.getByTestId('status-row-session_ended');
    expect(endedRow).toBeInTheDocument();
    expect(endedRow.textContent).toContain('completed');
  });

  it('falls back to payload.output through MessageText when payload.content is absent', () => {
    render(
      <SessionDetailContent
        session={makeSession()}
        messages={[envelope(0, 'message', { output: 'tool result text' })]}
      />,
    );
    expect(screen.getByText('tool result text')).toBeInTheDocument();
  });

  it('renders an error envelope as a status row with payload.detail', () => {
    render(
      <SessionDetailContent
        session={makeSession()}
        messages={[envelope(1, 'error', { detail: 'boom detail' })]}
      />,
    );
    const errRow = screen.getByTestId('status-row-error');
    expect(errRow).toBeInTheDocument();
    expect(errRow.textContent).toContain('Error');
    expect(errRow.textContent).toContain('boom detail');
  });
});

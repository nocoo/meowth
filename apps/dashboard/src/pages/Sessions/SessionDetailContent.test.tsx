import type { SessionInfo, SessionMessageRow } from '@/viewmodels/useSessionDetailViewModel';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import SessionDetailContent from './SessionDetailContent';

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
  return { v: 1, seq, ts: '2026-06-22T00:00:01Z', session_id: 'sid', type, payload };
}

function renderSession(messages: SessionMessageRow[] = [], overrides: Partial<SessionInfo> = {}) {
  return render(
    <MemoryRouter>
      <SessionDetailContent session={makeSession(overrides)} messages={messages} />
    </MemoryRouter>,
  );
}

describe('SessionDetailContent', () => {
  it('keeps the session title, id, backend, model, and timestamps', () => {
    renderSession([], { thread_name: 'Design review' });
    expect(screen.getByRole('heading', { name: 'Design review' })).toBeInTheDocument();
    expect(screen.getByTestId('session-detail-id')).toHaveTextContent('sid');
    expect(screen.getByText('opus')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Claude response' })).toBeInTheDocument();
    expect(
      screen.getByText(/Started 2026-06-22T00:00:00Z · Ended 2026-06-22T00:00:10Z/),
    ).toBeInTheDocument();
  });

  it('shows a running snapshot without inventing a live stream or an ended timestamp', () => {
    renderSession([], { status: 'running', ended_at: null, model: '' });
    expect(screen.getByText('Started 2026-06-22T00:00:00Z')).toBeInTheDocument();
    expect(screen.queryByText(/Ended/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Waiting for response')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry response' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Session details' })).not.toBeInTheDocument();
  });

  it('coalesces text deltas into Markdown and copies the complete response', async () => {
    const user = userEvent.setup();
    const content = '## Session review\n\nThe **layout** is ready.';
    const { container } = renderSession([
      envelope(0, 'session_started', { backend_type: 'claude' }),
      envelope(1, 'message', { kind: 'status', backend_session_id: 'provisional' }),
      envelope(2, 'message', { kind: 'text', content: '## Session re' }),
      envelope(3, 'heartbeat', {}),
      envelope(4, 'message', { kind: 'text', content: 'view\n\nThe **layout** is ready.' }),
      envelope(5, 'usage', { models: { opus: { input_tokens: 1234, output_tokens: 30 } } }),
      envelope(6, 'session_ended', { status: 'completed', duration_ms: 1500 }),
    ]);
    expect(screen.getByRole('heading', { name: 'Session review' })).toBeInTheDocument();
    expect(screen.getByText('layout').tagName).toBe('STRONG');
    expect(container.querySelectorAll('[data-bubble-kind="text"]')).toHaveLength(1);
    expect(screen.getByText('1.2k in / 30 out')).toBeInTheDocument();
    expect(screen.getByText('Completed in 1.5s')).toBeInTheDocument();
    expect(screen.queryByText(/Sequence|provisional/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(await navigator.clipboard.readText()).toBe(content);
  });

  it('keeps thinking and complete tool input/results inside keyboard-accessible disclosures', async () => {
    const user = userEvent.setup();
    const input = `${'x'.repeat(5000)} input-end`;
    const output = `${'y'.repeat(5000)} result-end <img src=x onerror=alert(1)>`;
    const thinking = `${'z'.repeat(9000)} **thinking-end**`;
    const { container } = renderSession([
      envelope(0, 'message', { kind: 'thinking', content: thinking }),
      envelope(1, 'message', {
        kind: 'tool-use',
        tool: 'read_file',
        call_id: 'read-1',
        input: { path: input },
      }),
      envelope(2, 'message', { kind: 'tool-result', call_id: 'read-1', output }),
      envelope(3, 'message', { kind: 'text', content: 'The review is complete.' }),
    ]);
    const activity = screen.getByRole('button', { name: 'Used 1 tool' });
    expect(activity).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/result-end/)).not.toBeInTheDocument();
    expect(screen.getByText('The review is complete.')).toBeInTheDocument();
    activity.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('thinking-end').tagName).toBe('STRONG');
    const tool = screen.getByRole('button', { name: 'Read file' });
    expect(tool).toHaveAttribute('aria-expanded', 'false');
    await user.click(tool);
    expect(container.querySelector('[data-bubble-kind="tool-use"]')).toHaveTextContent(input);
    expect(container.querySelector('[data-bubble-kind="tool-result"]')).toHaveTextContent(output);
    expect(container.querySelector('[data-bubble-kind="tool-result"] img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'View session details' })).not.toBeInTheDocument();
    await user.click(activity);
    expect(screen.queryByText(/result-end/)).not.toBeInTheDocument();
  });

  it('renders output beyond both Chat preview limits without a self-link', () => {
    const deltas = Array.from({ length: 1002 }, (_, seq) =>
      envelope(seq, 'message', { kind: 'text', content: 'A recorded fragment. ' }),
    );
    const { container } = renderSession([
      ...deltas,
      envelope(1002, 'message', {
        kind: 'text',
        content: '\n\n## Final section\n\nThe complete output ends here.',
      }),
      envelope(1003, 'session_ended', { status: 'completed', duration_ms: 1200 }),
    ]);
    expect(screen.getByRole('heading', { name: 'Final section' })).toBeInTheDocument();
    expect(screen.getByText('The complete output ends here.')).toBeInTheDocument();
    expect(screen.getByText('Completed in 1.2s')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chat-cap-banner"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /session details/i })).not.toBeInTheDocument();
  });

  it('preserves protocol error details and the recorded terminal error', () => {
    renderSession(
      [
        envelope(0, 'error', {
          code: 'upstream_error',
          title: 'Agent interrupted',
          detail: 'Connection closed unexpectedly.',
        }),
        envelope(1, 'session_ended', { status: 'failed', error: 'Agent process exited' }),
      ],
      { status: 'failed' },
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Agent interrupted')).toBeInTheDocument();
    expect(within(alert).getByText('Connection closed unexpectedly.')).toBeInTheDocument();
    expect(screen.getByText('Failed: Agent process exited')).toBeInTheDocument();
  });

  it('shows an honest empty state when only housekeeping events were recorded', () => {
    renderSession([
      envelope(0, 'session_started', { backend_type: 'claude' }),
      envelope(1, 'heartbeat', {}),
    ]);
    expect(screen.getByText('No agent output has been recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy response' })).not.toBeInTheDocument();
  });
});

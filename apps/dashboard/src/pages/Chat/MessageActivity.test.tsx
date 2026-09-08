import type { ChatTurn, Envelope } from '@/viewmodels/useChatViewModel';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import MessageList from './MessageList';

function event(kind: string, seq: number, payload = {}): Envelope {
  return {
    v: 1,
    seq,
    ts: '2026-09-08T08:00:00Z',
    session_id: 'activity-test',
    type: 'message',
    payload: { kind, ...payload },
  };
}

function turn(envelopes: Envelope[], status: ChatTurn['status'] = 'streaming'): ChatTurn {
  return {
    id: 'turn',
    sessionId: 'activity-test',
    backendSessionId: null,
    userPrompt: 'Check this',
    envelopes,
    status,
    startedAt: '2026-09-08T08:00:00Z',
    endedAt: null,
  };
}

function content(envelopes: Envelope[], status: ChatTurn['status'] = 'streaming') {
  return (
    <MemoryRouter>
      <MessageList turns={[turn(envelopes, status)]} agentName="Claude" onRetry={() => undefined} />
    </MemoryRouter>
  );
}

describe('chat activity', () => {
  it('hides thinking, inputs, and results behind one summary without hiding the answer', () => {
    render(
      content(
        [
          event('thinking', 1, { content: 'Inspect the **source**.' }),
          event('tool-use', 2, { tool: 'Read', call_id: 'read', input: { path: 'README.md' } }),
          event('tool-result', 3, { call_id: 'read', output: '<script>alert(1)</script>' }),
          event('text', 4, { content: 'Here is the answer.' }),
          event('error', 5, { content: 'A visible error' }),
        ],
        'completed',
      ),
    );
    const activity = screen.getByRole('button', { name: 'Used 1 tool' });
    expect(activity).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Inspect the/)).toBeNull();
    expect(screen.queryByText(/README.md/)).toBeNull();
    expect(screen.getByText('Here is the answer.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('A visible error');
    fireEvent.click(activity);
    expect(screen.getByText('source').tagName).toBe('STRONG');
    expect(screen.queryByText(/README.md/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read Input & result' }));
    expect(screen.getByText(/README.md/)).toBeVisible();
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
  });

  it('keeps expanded activity and tool details open as deltas and a result arrive', () => {
    const initial = [event('thinking', 1, { content: 'First ' })];
    const { rerender } = render(content(initial));
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
    const deltas = [
      ...initial,
      event('thinking', 2, { content: 'thought.' }),
      event('tool-use', 3, { tool: 'Bash', call_id: 'shell', input: { command: 'pwd' } }),
    ];
    rerender(content(deltas));
    expect(screen.getByRole('button', { name: 'Working with 1 tool' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('First thought.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Bash Input' }));
    rerender(
      content(
        [...deltas, event('tool-result', 4, { call_id: 'shell', output: '/project' })],
        'completed',
      ),
    );
    expect(screen.getByRole('button', { name: 'Used 1 tool' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Bash Input & result' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('/project')).toBeVisible();
  });

  it('keeps log-only and unmatched tool output available on demand', () => {
    const { rerender } = render(content([event('log', 1, { content: 'Diagnostic' })], 'completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Agent activity' }));
    expect(screen.getByText('Diagnostic')).toBeVisible();
    rerender(content([event('tool-result', 2, { output: 'Unpaired result' })], 'completed'));
    expect(screen.queryByText('Unpaired result')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Used 1 tool' }));
    expect(screen.getByText('Unpaired result')).toBeVisible();
  });
});

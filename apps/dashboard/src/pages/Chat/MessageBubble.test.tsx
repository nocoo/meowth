import type { Envelope } from '@/models/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import MessageBubble from './MessageBubble';

function makeEnvelope(over: Partial<Envelope> & Pick<Envelope, 'type'>): Envelope {
  return {
    v: 1,
    seq: 0,
    ts: '2026-06-30T07:00:00Z',
    session_id: 'sid-fixture',
    payload: {},
    ...over,
  };
}

function renderBubble(env: Envelope) {
  return render(
    <MemoryRouter>
      <MessageBubble envelope={env} />
    </MemoryRouter>,
  );
}

describe('MessageBubble dispatch (§5.1)', () => {
  it('session_started → renders nothing', () => {
    const { container } = renderBubble(makeEnvelope({ type: 'session_started' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('heartbeat → renders nothing', () => {
    const { container } = renderBubble(makeEnvelope({ type: 'heartbeat' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('message.kind=status → renders nothing (§3.3 provisional id, not surfaced)', () => {
    const { container } = renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'status', backend_session_id: 'cache-id' },
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('message.kind=text → renders content via MessageText', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'text', content: 'hello world' },
      }),
    );
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('message.kind=text > 8 KiB → truncates and appends Sessions deep link', () => {
    const big = 'x'.repeat(9 * 1024);
    renderBubble(
      makeEnvelope({
        type: 'message',
        session_id: 'sid-99',
        payload: { kind: 'text', content: big },
      }),
    );
    expect(screen.getByText('view in Sessions detail')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'view in Sessions detail' });
    expect(link).toHaveAttribute('href', '/sessions/sid-99');
  });

  it('message.kind=thinking → collapsible details block', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'thinking', content: 'pondering' },
      }),
    );
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('message.kind=tool-use → shows tool name and JSON-stringified input', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: {
          kind: 'tool-use',
          tool: 'Bash',
          input: { cmd: 'ls', flag: true },
        },
      }),
    );
    expect(screen.getByText(/tool: Bash/)).toBeInTheDocument();
    expect(screen.getByText(/"cmd":"ls"/)).toBeInTheDocument();
  });

  it('message.kind=tool-use input > 200 char → truncated + Sessions link', () => {
    const huge = { v: 'y'.repeat(500) };
    renderBubble(
      makeEnvelope({
        type: 'message',
        session_id: 'sid-tu',
        payload: { kind: 'tool-use', tool: 'X', input: huge },
      }),
    );
    expect(screen.getByText('view in Sessions detail')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sessions/sid-tu');
  });

  it('message.kind=tool-result → shows output preview', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'tool-result', output: '42\n' },
      }),
    );
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it('message.kind=tool-result output > 4 KiB → truncated + Sessions link', () => {
    const big = 'z'.repeat(5 * 1024);
    renderBubble(
      makeEnvelope({
        type: 'message',
        session_id: 'sid-tr',
        payload: { kind: 'tool-result', output: big },
      }),
    );
    expect(screen.getByText('view in Sessions detail')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sessions/sid-tr');
  });

  it('message.kind=error with payload.content → renders content (02 §5.3 mapping)', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'error', content: 'boom from backend' },
      }),
    );
    const node = document.querySelector('[data-bubble-kind="error"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.className).toMatch(/destructive/);
    expect(screen.getByText('boom from backend')).toBeInTheDocument();
  });

  it('message.kind=error with title/detail fallback (degrades gracefully)', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'error', title: 'boom', detail: 'context' },
      }),
    );
    const node = document.querySelector('[data-bubble-kind="error"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.className).toMatch(/destructive/);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('context')).toBeInTheDocument();
  });

  it('message.kind=log → collapsible details block', () => {
    renderBubble(
      makeEnvelope({
        type: 'message',
        payload: { kind: 'log', content: 'diag' },
      }),
    );
    expect(screen.getByText('log')).toBeInTheDocument();
  });

  it('envelope.type=error → yellow protocol-error style (distinct from kind=error red)', () => {
    renderBubble(
      makeEnvelope({
        type: 'error',
        payload: { code: 'BAD_GATEWAY', title: 'upstream failed' },
      }),
    );
    const node = document.querySelector('[data-bubble-kind="protocol-error"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.className).toMatch(/yellow/);
    expect(screen.getByText('BAD_GATEWAY')).toBeInTheDocument();
    expect(screen.getByText('upstream failed')).toBeInTheDocument();
  });

  it('session_ended completed + duration_ms → "✓ completed in 4.2s"', () => {
    renderBubble(
      makeEnvelope({
        type: 'session_ended',
        payload: {
          status: 'completed',
          backend_session_id: 'bsid-1',
          duration_ms: 4200,
        },
      }),
    );
    expect(screen.getByText(/✓ completed/)).toBeInTheDocument();
    expect(screen.getByText(/in 4\.2s/)).toBeInTheDocument();
  });

  it('session_ended failed + error → "✗ failed: <error>"', () => {
    renderBubble(
      makeEnvelope({
        type: 'session_ended',
        payload: {
          status: 'failed',
          error: 'backend stream closed early',
        },
      }),
    );
    expect(screen.getByText(/✗ failed/)).toBeInTheDocument();
    expect(screen.getByText(/backend stream closed early/)).toBeInTheDocument();
  });

  it('session_ended cancelled → "⊘ cancelled" (no duration suffix)', () => {
    renderBubble(
      makeEnvelope({
        type: 'session_ended',
        payload: { status: 'cancelled' },
      }),
    );
    expect(screen.getByText(/⊘ cancelled/)).toBeInTheDocument();
  });

  it('session_ended completed without duration_ms → prefix only, no "in"', () => {
    renderBubble(
      makeEnvelope({
        type: 'session_ended',
        payload: { status: 'completed' },
      }),
    );
    expect(screen.getByText('✓ completed')).toBeInTheDocument();
    expect(screen.queryByText(/in /)).toBeNull();
  });
});

describe('MessageBubble usage badge (02 §5.4 payload.models)', () => {
  function makeUsage(models: Record<string, Record<string, unknown>>): Envelope {
    return makeEnvelope({ type: 'usage', payload: { models } });
  }

  it('single model: 12_400 in / 3_100 out → "12.4k in / 3.1k out"', () => {
    renderBubble(
      makeUsage({
        'claude-3.5': { input_tokens: 12_400, output_tokens: 3_100 },
      }),
    );
    expect(screen.getByText('12.4k in / 3.1k out')).toBeInTheDocument();
  });

  it('multi-model: tokens are summed across map values', () => {
    renderBubble(
      makeUsage({
        a: { input_tokens: 1000, output_tokens: 500 },
        b: { input_tokens: 2000, output_tokens: 300 },
      }),
    );
    expect(screen.getByText('3.0k in / 800 out')).toBeInTheDocument();
  });

  it('boundary: 999 stays as raw number; 1000 flips to "1.0k"', () => {
    renderBubble(
      makeUsage({
        m: { input_tokens: 999, output_tokens: 1000 },
      }),
    );
    expect(screen.getByText('999 in / 1.0k out')).toBeInTheDocument();
  });

  it('missing payload.models → shows "-"', () => {
    renderBubble(makeEnvelope({ type: 'usage', payload: {} }));
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('empty payload.models map → shows "-" (not "0 in / 0 out")', () => {
    renderBubble(makeUsage({}));
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('0 in / 0 out')).toBeNull();
  });

  it('non-number tokens (string / undefined / null) → counted as 0', () => {
    renderBubble(
      makeUsage({
        m: {
          input_tokens: 'oops' as unknown as number,
          output_tokens: null as unknown as number,
        },
      }),
    );
    expect(screen.getByText('0 in / 0 out')).toBeInTheDocument();
  });
});

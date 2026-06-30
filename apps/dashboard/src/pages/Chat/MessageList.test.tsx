import type { ChatTurn } from '@/models/chat';
import type { Envelope } from '@/models/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import MessageList from './MessageList';

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

function makeTurn(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    sessionId: null,
    backendSessionId: null,
    userPrompt: 'hi',
    envelopes: [],
    status: 'completed',
    startedAt: '2026-06-30T07:00:00Z',
    endedAt: '2026-06-30T07:00:01Z',
    ...over,
  };
}

function renderList(turns: readonly ChatTurn[]) {
  return render(
    <MemoryRouter>
      <MessageList turns={turns} />
    </MemoryRouter>,
  );
}

describe('MessageList', () => {
  it('empty turns → renders the bare "Start a conversation." hint', () => {
    renderList([]);
    expect(screen.getByText('Start a conversation.')).toBeInTheDocument();
  });

  it('renders the userPrompt of each turn through MessageText', () => {
    renderList([makeTurn({ userPrompt: 'hello there' })]);
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('renders each envelope of a turn through MessageBubble (text bubble visible)', () => {
    const turn = makeTurn({
      envelopes: [
        makeEnvelope({
          type: 'message',
          payload: { kind: 'text', content: 'streamed reply' },
        }),
      ],
    });
    const { container } = renderList([turn]);
    expect(container.querySelector('[data-bubble-kind="text"]')).not.toBeNull();
    expect(screen.getByText('streamed reply')).toBeInTheDocument();
  });

  it('preserves the order of multiple turns', () => {
    const turns = [
      makeTurn({ userPrompt: 'first prompt' }),
      makeTurn({ userPrompt: 'second prompt' }),
      makeTurn({ userPrompt: 'third prompt' }),
    ];
    renderList(turns);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveTextContent('first prompt');
    expect(articles[1]).toHaveTextContent('second prompt');
    expect(articles[2]).toHaveTextContent('third prompt');
  });

  it('caps at 1000 RAW envelopes per turn and surfaces a banner linking the Sessions detail', () => {
    // Interleave text + tool-use so coalescing cannot collapse the
    // window into a single bubble; this lets us prove the cap acts
    // on RAW envelopes (1001 → 1000 kept) independently of §5.1
    // text grouping. Even indices are text, odd are tool-use.
    const envelopes: Envelope[] = Array.from({ length: 1001 }, (_, i) =>
      i % 2 === 0
        ? makeEnvelope({ type: 'message', seq: i, payload: { kind: 'text', content: `t${i}` } })
        : makeEnvelope({
            type: 'message',
            seq: i,
            payload: { kind: 'tool-use', tool: 'Read', input: { i } },
          }),
    );
    const turn = makeTurn({ sessionId: 'sid-cap', envelopes });
    const { container } = renderList([turn]);
    const banner = container.querySelector('[data-slot="chat-cap-banner"]') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('Cumulative envelope cap');
    const link = screen.getByRole('link', { name: 'view in Sessions detail' });
    expect(link).toHaveAttribute('href', '/sessions/sid-cap');
    // 1000 kept raw envelopes: 500 text (each isolated by a tool-use
    // boundary, so no coalescing) + 500 tool-use. The dropped 1001st
    // is a text envelope (even index 1000).
    expect(container.querySelectorAll('[data-bubble-kind="text"]')).toHaveLength(500);
    expect(container.querySelectorAll('[data-bubble-kind="tool-use"]')).toHaveLength(500);
  });

  it('coalesces consecutive text envelopes into one bubble (§5.1)', () => {
    const turn = makeTurn({
      sessionId: 'sid-merge',
      envelopes: [
        makeEnvelope({ type: 'message', seq: 1, payload: { kind: 'text', content: 'Hel' } }),
        makeEnvelope({ type: 'message', seq: 2, payload: { kind: 'text', content: 'lo ' } }),
        makeEnvelope({ type: 'message', seq: 3, payload: { kind: 'text', content: 'world' } }),
      ],
    });
    const { container } = renderList([turn]);
    expect(container.querySelectorAll('[data-bubble-kind="text"]')).toHaveLength(1);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('cap banner renders without a Link when turn.sessionId is null', () => {
    const envelopes: Envelope[] = Array.from({ length: 1001 }, (_, i) =>
      makeEnvelope({
        type: 'message',
        seq: i,
        payload: { kind: 'text', content: `msg ${i}` },
      }),
    );
    const turn = makeTurn({ sessionId: null, envelopes });
    renderList([turn]);
    expect(screen.queryByRole('link', { name: 'view in Sessions detail' })).toBeNull();
    expect(screen.getByText(/Cumulative envelope cap/)).toBeInTheDocument();
    expect(screen.getByText('view in Sessions detail')).toBeInTheDocument();
  });
});

describe('MessageList streaming pending indicator (§4.4)', () => {
  function streamingTurn(envelopes: Envelope[] = []): ChatTurn {
    return makeTurn({ status: 'streaming', endedAt: null, envelopes });
  }

  it('shows the pending bubble while streaming with no envelopes yet', () => {
    const { container } = renderList([streamingTurn([])]);
    expect(container.querySelector('[data-bubble-kind="streaming-pending"]')).not.toBeNull();
  });

  it('shows the pending bubble while streaming with only invisible envelopes', () => {
    const turn = streamingTurn([
      makeEnvelope({ type: 'session_started', seq: 0 }),
      makeEnvelope({ type: 'heartbeat', seq: 1 }),
      makeEnvelope({
        type: 'message',
        seq: 2,
        payload: { kind: 'status', backend_session_id: 'cache' },
      }),
    ]);
    const { container } = renderList([turn]);
    expect(container.querySelector('[data-bubble-kind="streaming-pending"]')).not.toBeNull();
  });

  it('hides the pending bubble once a visible text envelope arrives', () => {
    const turn = streamingTurn([
      makeEnvelope({ type: 'session_started', seq: 0 }),
      makeEnvelope({ type: 'message', seq: 1, payload: { kind: 'text', content: 'hi' } }),
    ]);
    const { container } = renderList([turn]);
    expect(container.querySelector('[data-bubble-kind="streaming-pending"]')).toBeNull();
    expect(container.querySelector('[data-bubble-kind="text"]')).not.toBeNull();
  });

  it('hides the pending bubble once a visible tool-use envelope arrives', () => {
    const turn = streamingTurn([
      makeEnvelope({
        type: 'message',
        seq: 0,
        payload: { kind: 'tool-use', tool: 'Read', input: { path: '/x' } },
      }),
    ]);
    const { container } = renderList([turn]);
    expect(container.querySelector('[data-bubble-kind="streaming-pending"]')).toBeNull();
  });

  it('never shows the pending bubble for a non-streaming (completed) turn', () => {
    const turn = makeTurn({ status: 'completed', envelopes: [] });
    const { container } = renderList([turn]);
    expect(container.querySelector('[data-bubble-kind="streaming-pending"]')).toBeNull();
  });

  it('only the LAST turn can show pending — an earlier streaming-empty turn does not', () => {
    // Defensive: even if a non-last turn is (incorrectly) still
    // streaming with no visible content, MessageList must not render
    // pending for it once a later turn exists. Only one pending
    // bubble at most, and only for the final turn.
    const stale = streamingTurn([]); // earlier turn, still streaming
    const later = makeTurn({ status: 'completed', userPrompt: 'next', envelopes: [] });
    const { container } = renderList([stale, later]);
    expect(container.querySelectorAll('[data-bubble-kind="streaming-pending"]')).toHaveLength(0);
  });

  it('shows pending for the last turn when it is the streaming one after a completed turn', () => {
    const done = makeTurn({ status: 'completed', userPrompt: 'first', envelopes: [] });
    const active = streamingTurn([]); // last turn, streaming, empty
    const { container } = renderList([done, active]);
    expect(container.querySelectorAll('[data-bubble-kind="streaming-pending"]')).toHaveLength(1);
  });
});

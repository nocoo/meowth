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

  it('caps at 1000 envelopes per turn and surfaces a banner linking the Sessions detail', () => {
    const envelopes: Envelope[] = Array.from({ length: 1001 }, (_, i) =>
      makeEnvelope({
        type: 'message',
        seq: i,
        payload: { kind: 'text', content: `msg ${i}` },
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
    expect(container.querySelectorAll('[data-bubble-kind="text"]')).toHaveLength(1000);
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

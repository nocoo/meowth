import type { Envelope } from '@/models/types';
import { describe, expect, it } from 'vitest';
import { groupEnvelopes } from './messageGroups';

function makeEnvelope(over: Partial<Envelope> & Pick<Envelope, 'type'>): Envelope {
  return {
    v: 1,
    seq: 0,
    ts: '2026-06-30T07:00:00Z',
    session_id: 'sid',
    payload: {},
    ...over,
  };
}

function text(content: string, seq = 0): Envelope {
  return makeEnvelope({ type: 'message', seq, payload: { kind: 'text', content } });
}

function payloadContent(env: Envelope): string {
  const payload = env.payload as { content?: unknown };
  return typeof payload.content === 'string' ? payload.content : '';
}

describe('groupEnvelopes (§5.1 text coalescing)', () => {
  it('returns an empty array for no envelopes', () => {
    expect(groupEnvelopes([])).toEqual([]);
  });

  it('merges consecutive text envelopes into a single text envelope', () => {
    const out = groupEnvelopes([text('Hel', 1), text('lo ', 2), text('world', 3)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('message');
    expect(payloadContent(out[0] as Envelope)).toBe('Hello world');
  });

  it('keeps a single text envelope unchanged (same reference)', () => {
    const only = text('solo', 1);
    const out = groupEnvelopes([only]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(only);
  });

  it('does NOT merge text across a tool-use boundary', () => {
    const toolUse = makeEnvelope({
      type: 'message',
      seq: 2,
      payload: { kind: 'tool-use', tool: 'Read', input: { path: '/x' } },
    });
    const out = groupEnvelopes([text('before ', 1), toolUse, text('after', 3)]);
    expect(out).toHaveLength(3);
    expect(payloadContent(out[0] as Envelope)).toBe('before ');
    expect(out[1]).toBe(toolUse);
    expect(payloadContent(out[2] as Envelope)).toBe('after');
  });

  it('does NOT merge text across a thinking boundary', () => {
    const thinking = makeEnvelope({
      type: 'message',
      seq: 2,
      payload: { kind: 'thinking', content: 'hmm' },
    });
    const out = groupEnvelopes([text('a', 1), thinking, text('b', 3)]);
    expect(out).toHaveLength(3);
    expect(payloadContent(out[0] as Envelope)).toBe('a');
    expect(out[1]).toBe(thinking);
    expect(payloadContent(out[2] as Envelope)).toBe('b');
  });

  it('drops session_started without producing an empty bubble', () => {
    const started = makeEnvelope({ type: 'session_started', seq: 0 });
    const out = groupEnvelopes([started, text('hi', 1)]);
    expect(out).toHaveLength(1);
    expect(payloadContent(out[0] as Envelope)).toBe('hi');
  });

  it('drops heartbeat WITHOUT breaking a surrounding text run', () => {
    const heartbeat = makeEnvelope({ type: 'heartbeat', seq: 2 });
    const out = groupEnvelopes([text('one ', 1), heartbeat, text('two', 3)]);
    expect(out).toHaveLength(1);
    expect(payloadContent(out[0] as Envelope)).toBe('one two');
  });

  it('drops message.kind=status WITHOUT breaking a surrounding text run', () => {
    const status = makeEnvelope({
      type: 'message',
      seq: 2,
      payload: { kind: 'status', backend_session_id: 'cache' },
    });
    const out = groupEnvelopes([text('x', 1), status, text('y', 3)]);
    expect(out).toHaveLength(1);
    expect(payloadContent(out[0] as Envelope)).toBe('xy');
  });

  it('preserves the first text envelope metadata on a merged run', () => {
    const out = groupEnvelopes([text('a', 5), text('b', 6)]).map((e) => e);
    expect(out[0]?.seq).toBe(5);
    expect(out[0]?.session_id).toBe('sid');
  });

  it('passes session_ended through as a boundary after a text run', () => {
    const ended = makeEnvelope({
      type: 'session_ended',
      seq: 9,
      payload: { status: 'completed', backend_session_id: 'bsid' },
    });
    const out = groupEnvelopes([text('done', 1), ended]);
    expect(out).toHaveLength(2);
    expect(payloadContent(out[0] as Envelope)).toBe('done');
    expect(out[1]).toBe(ended);
  });

  it('passes type=error (protocol error) through as a boundary', () => {
    const protoErr = makeEnvelope({
      type: 'error',
      seq: 2,
      payload: { code: 'X', title: 'boom' },
    });
    const out = groupEnvelopes([text('a', 1), protoErr, text('b', 3)]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(protoErr);
  });

  it('does not mutate the input array or its envelopes', () => {
    const input = [text('a', 1), text('b', 2)];
    const snapshot = JSON.stringify(input);
    groupEnvelopes(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).toHaveLength(2);
  });
});

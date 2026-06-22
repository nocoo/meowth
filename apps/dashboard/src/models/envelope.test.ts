import { describe, expect, it } from 'vitest';
import { decodeChunk, decodeLine } from './envelope';
import type { Envelope } from './types';

function env(overrides: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    seq: 1,
    ts: '2026-06-22T00:00:00Z',
    session_id: 'sid',
    type: 'message',
    payload: { text: 'hi' },
    ...overrides,
  } as Envelope;
}

describe('decodeLine', () => {
  it('returns null for an empty line', () => {
    expect(decodeLine('')).toBeNull();
    expect(decodeLine('   ')).toBeNull();
  });

  it('returns null when the line is not valid JSON', () => {
    expect(decodeLine('not json')).toBeNull();
  });

  it('accepts a session_started envelope', () => {
    const e = env({ type: 'session_started', payload: { backend: 'claude' } });
    expect(decodeLine(JSON.stringify(e))).toEqual(e);
  });

  it('accepts a message envelope', () => {
    const e = env({ type: 'message', payload: { content: 'hello' } });
    expect(decodeLine(JSON.stringify(e))).toEqual(e);
  });

  it('accepts an error envelope', () => {
    const e = env({ type: 'error', payload: { detail: 'boom' } });
    expect(decodeLine(JSON.stringify(e))).toEqual(e);
  });

  it('accepts a heartbeat envelope', () => {
    const e = env({ type: 'heartbeat', payload: {} });
    expect(decodeLine(JSON.stringify(e))).toEqual(e);
  });

  it('rejects v !== 1 (e.g. future v=2 from an upgraded daemon)', () => {
    const raw = JSON.stringify({ ...env(), v: 2 });
    expect(decodeLine(raw)).toBeNull();
  });

  it('rejects an unknown envelope type', () => {
    const raw = JSON.stringify({ ...env(), type: 'agent_message' });
    expect(decodeLine(raw)).toBeNull();
  });

  it('rejects non-numeric seq', () => {
    const raw = JSON.stringify({ ...env(), seq: 'first' });
    expect(decodeLine(raw)).toBeNull();
  });

  it('rejects when payload is not a plain object', () => {
    const raw = JSON.stringify({ ...env(), payload: null });
    expect(decodeLine(raw)).toBeNull();
    const rawArr = JSON.stringify({ ...env(), payload: [1, 2, 3] });
    expect(decodeLine(rawArr)).toBeNull();
  });

  it('rejects when ts or session_id is missing/empty', () => {
    const noTs = JSON.stringify({ ...env(), ts: '' });
    expect(decodeLine(noTs)).toBeNull();
    const noSid = JSON.stringify({ ...env(), session_id: '' });
    expect(decodeLine(noSid)).toBeNull();
  });
});

describe('decodeChunk', () => {
  it('decodes one complete line and reports no remainder', () => {
    const e = env();
    const r = decodeChunk('', `${JSON.stringify(e)}\n`);
    expect(r.envelopes).toEqual([e]);
    expect(r.remaining).toBe('');
  });

  it('buffers a partial trailing line until the next chunk completes it', () => {
    const e1 = env({ seq: 1 });
    const e2 = env({ seq: 2 });
    const full = `${JSON.stringify(e1)}\n${JSON.stringify(e2)}`;
    const cut = full.length - 5;
    const r1 = decodeChunk('', full.slice(0, cut));
    expect(r1.envelopes).toEqual([e1]);
    expect(r1.remaining.length).toBeGreaterThan(0);
    const r2 = decodeChunk(r1.remaining, `${full.slice(cut)}\n`);
    expect(r2.envelopes).toEqual([e2]);
    expect(r2.remaining).toBe('');
  });

  it('drops invalid lines but keeps surrounding valid ones', () => {
    const good = env({ seq: 1 });
    const chunk = `${JSON.stringify(good)}\n\nnot json\n${JSON.stringify(env({ seq: 2 }))}\n`;
    const r = decodeChunk('', chunk);
    expect(r.envelopes.map((e) => e.seq)).toEqual([1, 2]);
    expect(r.remaining).toBe('');
  });
});

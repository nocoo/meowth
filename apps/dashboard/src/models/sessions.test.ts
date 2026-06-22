import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession, getSessionMessages, listSessions } from './sessions';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('models/sessions.listSessions', () => {
  it('GETs /v1/sessions with no query when called without options', async () => {
    const body = { sessions: [] };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await listSessions();
    expect(out).toEqual(body);
    const [path] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/sessions');
  });

  it('encodes status + limit + before into the query string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    );
    const spy = vi.spyOn(globalThis, 'fetch');
    await listSessions({ status: 'running', limit: 10, before: '2026-06-22T00:00:00Z' });
    const [path] = spy.mock.calls.at(-1) ?? [];
    expect(path).toContain('status=running');
    expect(path).toContain('limit=10');
    expect(path).toContain('before=');
  });

  it('joins multiple statuses with a comma', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    );
    const spy = vi.spyOn(globalThis, 'fetch');
    await listSessions({ status: ['running', 'completed'] });
    const [path] = spy.mock.calls.at(-1) ?? [];
    expect(path).toContain('status=running%2Ccompleted');
  });
});

describe('models/sessions.getSession', () => {
  it('GETs /v1/sessions/:id and returns the body, encoding the id', async () => {
    const sess = { id: 'a/b', backend_type: 'claude', status: 'running' };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sess), { status: 200 }));
    const out = await getSession('a/b');
    expect(out).toEqual(sess);
    const [path] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/sessions/a%2Fb');
  });

  it('throws ApiError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/session_not_found', title: 'Not Found', status: 404 }),
        { status: 404 },
      ),
    );
    await expect(getSession('missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('models/sessions.getSessionMessages', () => {
  it('GETs /v1/sessions/:id/messages with no query when called with no opts', async () => {
    const body = { session_id: 'sid', events: [], next_after_seq: 0, has_more: false };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await getSessionMessages('sid');
    expect(out).toEqual(body);
    const [path] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/sessions/sid/messages');
  });

  it('encodes after_seq + limit + types CSV', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ session_id: 'sid', events: [], next_after_seq: 0, has_more: false }),
        { status: 200 },
      ),
    );
    const spy = vi.spyOn(globalThis, 'fetch');
    await getSessionMessages('sid', {
      after_seq: 42,
      limit: 100,
      types: ['message', 'session_ended'],
    });
    const [path] = spy.mock.calls.at(-1) ?? [];
    expect(path).toContain('after_seq=42');
    expect(path).toContain('limit=100');
    expect(path).toContain('types=message%2Csession_ended');
  });

  it('omits the types param when the array is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ session_id: 'sid', events: [], next_after_seq: 0, has_more: false }),
        { status: 200 },
      ),
    );
    const spy = vi.spyOn(globalThis, 'fetch');
    await getSessionMessages('sid', { types: [] });
    const [path] = spy.mock.calls.at(-1) ?? [];
    expect(path).toBe('/v1/sessions/sid/messages');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToken, listTokens, revokeToken } from './tokens';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('models/tokens', () => {
  it('listTokens GETs /v1/tokens and returns the parsed list', async () => {
    const body = { tokens: [] };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await listTokens();
    expect(out).toEqual(body);
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/tokens');
    expect(init?.method).toBeUndefined();
  });

  it('createToken POSTs JSON body with the requested name', async () => {
    const secret = `mwt_${'A'.repeat(39)}`;
    const resp = {
      id: 'id-1',
      name: 'ci',
      prefix: secret.slice(0, 9),
      secret,
      created_at: '2026-06-22T00:00:00Z',
      created_via: 'dashboard',
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(resp), { status: 201 }));
    const out = await createToken({ name: 'ci' });
    expect(out).toEqual(resp);
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/tokens');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'ci' }));
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('revokeToken DELETEs /v1/tokens/:id and returns the {id, revoked_at} body', async () => {
    const body = { id: 'abc-123', revoked_at: '2026-06-22T01:00:00Z' };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await revokeToken('abc-123');
    expect(out).toEqual(body);
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/tokens/abc-123');
    expect(init?.method).toBe('DELETE');
  });

  it('revokeToken URL-encodes ids with reserved characters', async () => {
    const body = { id: 'has/slash', revoked_at: '2026-06-22T01:00:00Z' };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await revokeToken('has/slash');
    const [path] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/tokens/has%2Fslash');
  });

  it('propagates a 401 as ApiError (caller decides redirect)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    await expect(listTokens()).rejects.toMatchObject({ status: 401 });
  });

  it('propagates a network rejection as-is', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    await expect(listTokens()).rejects.toBe(netErr);
  });
});

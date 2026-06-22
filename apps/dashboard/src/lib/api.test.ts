import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiStream, isApiError } from './api';
import { getStoredToken, setStoredToken } from './localStorage';

const TOKEN_KEY = 'meowth_token';

function mockResponse(body: BodyInit | null, init: ResponseInit = { status: 200 }): Response {
  return new Response(body, init);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('apiFetch — headers', () => {
  it('omits Authorization when no token is stored', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/agents');
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('attaches Authorization: Bearer <token> when one is stored', async () => {
    setStoredToken('mwt_example');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/agents');
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer mwt_example');
  });

  it('preserves a caller-supplied custom header alongside Authorization', async () => {
    setStoredToken('mwt_example');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/agents', { headers: { 'X-Request-Id': 'req-1' } });
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer mwt_example');
    expect(headers.get('X-Request-Id')).toBe('req-1');
  });

  it('defaults Content-Type to JSON for non-GET requests carrying a body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/tokens', { method: 'POST', body: '{"name":"x"}' });
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('does not override a caller-supplied Content-Type', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/tokens', {
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    });
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Content-Type')).toBe('text/plain');
  });

  it('does not add Content-Type for GET requests without a body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"ok":true}'));
    await apiFetch('/v1/agents');
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Content-Type')).toBe(false);
  });
});

describe('apiFetch — body decode', () => {
  it('parses a JSON success body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse('{"agents":["claude"]}'));
    const out = await apiFetch<{ agents: string[] }>('/v1/agents');
    expect(out).toEqual({ agents: ['claude'] });
  });

  it('returns undefined on 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(null, { status: 204 }));
    const out = await apiFetch<void>('/v1/tokens/abc', { method: 'DELETE' });
    expect(out).toBeUndefined();
  });
});

describe('apiFetch — failure mapping', () => {
  it('throws a structured ApiError for a 4xx problem+json body', async () => {
    const problem = {
      type: '/problems/bad_input',
      title: 'Bad input',
      status: 400,
      detail: 'name too long',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(JSON.stringify(problem), { status: 400 }),
    );
    try {
      await apiFetch('/v1/tokens', { method: 'POST', body: '{}' });
      throw new Error('expected throw');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      if (isApiError(err)) {
        expect(err.status).toBe(400);
        expect(err.problem).toEqual(problem);
      }
    }
  });

  it('falls back to /problems/unknown when the body is not a problem shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('not json at all', { status: 502, statusText: 'Bad Gateway' }),
    );
    try {
      await apiFetch('/v1/agents');
      throw new Error('expected throw');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      if (isApiError(err)) {
        expect(err.status).toBe(502);
        expect(err.problem.type).toBe('/problems/unknown');
        expect(err.problem.title).toBe('Bad Gateway');
        expect(err.problem.status).toBe(502);
      }
    }
  });

  it('on 401, clears the stored token before throwing', async () => {
    setStoredToken('mwt_should_be_cleared');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('{"type":"/problems/unauthorized","title":"Unauthorized","status":401}', {
        status: 401,
      }),
    );
    await expect(apiFetch('/v1/agents')).rejects.toMatchObject({ status: 401 });
    expect(getStoredToken()).toBeNull();
  });

  it('on network rejection, keeps the stored token and propagates a non-ApiError', async () => {
    setStoredToken('mwt_keep_me');
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    let captured: unknown;
    try {
      await apiFetch('/v1/agents');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBe(netErr);
    expect(isApiError(captured)).toBe(false);
    expect(getStoredToken()).toBe('mwt_keep_me');
  });
});

describe('apiStream', () => {
  it('returns the response body stream on 200', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const stream = await apiStream('/v1/sessions/abc/messages');
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it('on 401, clears token and throws ApiError', async () => {
    setStoredToken('mwt_should_be_cleared');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: '/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
        }),
        { status: 401 },
      ),
    );
    await expect(apiStream('/v1/sessions/abc/messages')).rejects.toMatchObject({
      status: 401,
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('on network rejection, keeps token and propagates the original error', async () => {
    setStoredToken('mwt_keep_me');
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    let captured: unknown;
    try {
      await apiStream('/v1/sessions/abc/messages');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBe(netErr);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('mwt_keep_me');
  });
});

describe('isApiError', () => {
  it('accepts a fully-shaped ApiError', () => {
    expect(
      isApiError({
        status: 400,
        problem: { type: '/x', title: 'x', status: 400 },
      }),
    ).toBe(true);
  });

  it('rejects plain Error instances', () => {
    expect(isApiError(new Error('boom'))).toBe(false);
  });

  it('rejects shapes missing required problem fields', () => {
    expect(isApiError({ status: 400, problem: { type: '/x', title: 'x' } })).toBe(false);
    expect(isApiError({ status: 400, problem: null })).toBe(false);
  });
});

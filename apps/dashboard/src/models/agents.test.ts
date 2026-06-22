import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execAgent, fetchAgents } from './agents';
import type { Agent, ExecRequest } from './types';

type AgentType = Agent['type'];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('models/agents.fetchAgents', () => {
  it('GETs /v1/agents and returns the parsed AgentListResponse', async () => {
    const body = { agents: [{ type: 'claude', installed: true, executable: '/x', version: '1' }] };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchAgents();
    expect(spy).toHaveBeenCalledWith(
      '/v1/agents',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(out).toEqual(body);
  });

  it('propagates an HTTP 401 as ApiError (caller decides redirect)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    await expect(fetchAgents()).rejects.toMatchObject({ status: 401 });
  });

  it('propagates a network rejection as the original error', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    await expect(fetchAgents()).rejects.toBe(netErr);
  });
});

describe('models/agents.execAgent', () => {
  const req: ExecRequest = { prompt: 'hello' };

  function streamingResponse(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  it('POSTs /v1/agents/:type/exec with a JSON body and returns a stream', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingResponse());
    const stream = await execAgent('claude', req);
    expect(stream).toBeInstanceOf(ReadableStream);
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/agents/claude/exec');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify(req));
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('passes through the caller-supplied AbortSignal', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingResponse());
    const controller = new AbortController();
    await execAgent('claude', req, { signal: controller.signal });
    const init = spy.mock.calls[0]?.[1];
    expect(init?.signal).toBe(controller.signal);
  });

  it('URL-encodes the backend type segment when it contains reserved characters', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingResponse());
    // Cast to bypass the AgentType union; this is a model-layer
    // path-builder regression test, not a claim that daemon
    // accepts the value.
    await execAgent('bad/type' as AgentType, req);
    const [path] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/v1/agents/bad%2Ftype/exec');
  });

  it('propagates an HTTP 400 invalid_request as ApiError', async () => {
    const problem = {
      type: '/problems/invalid_request',
      title: 'Invalid request',
      status: 400,
      detail: 'prompt must not be empty',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 400 }),
    );
    try {
      await execAgent('claude', req);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toMatchObject({ status: 400, problem });
    }
  });

  it('propagates an HTTP 404 as ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unknown_backend', title: 'Not Found', status: 404 }),
        { status: 404 },
      ),
    );
    await expect(execAgent('claude', req)).rejects.toMatchObject({ status: 404 });
  });

  it('propagates an HTTP 503 as ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: '/problems/backend_unavailable',
          title: 'Backend unavailable',
          status: 503,
        }),
        { status: 503 },
      ),
    );
    await expect(execAgent('claude', req)).rejects.toMatchObject({ status: 503 });
  });

  it('propagates a network rejection as the original error', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    await expect(execAgent('claude', req)).rejects.toBe(netErr);
  });
});

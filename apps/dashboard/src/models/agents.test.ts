import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAgents } from './agents';

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

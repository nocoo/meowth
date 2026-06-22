import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pingHealthz } from './health';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('models/health.pingHealthz', () => {
  it('GETs /healthz and returns the parsed body', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const out = await pingHealthz();
    expect(out).toEqual({ ok: true });
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/healthz');
    // No bearer was set, so Authorization must be absent.
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('propagates a network rejection', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    await expect(pingHealthz()).rejects.toBe(netErr);
  });
});

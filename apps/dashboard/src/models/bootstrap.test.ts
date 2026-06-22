import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintWithSetupCode } from './bootstrap';
import type { MintResponse } from './types';

const VALID_CODE = `mws_${'A'.repeat(39)}`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('models/bootstrap.mintWithSetupCode', () => {
  it('POSTs /bootstrap/mint with a JSON setup_code body and returns the parsed MintResponse', async () => {
    const resp: MintResponse = {
      id: '0193-aaaa',
      name: 'bootstrap',
      prefix: 'mws_AAAAA',
      secret: `mwt_${'B'.repeat(39)}`,
      created_at: '2026-06-22T00:00:00Z',
      created_via: 'first_run_mint',
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(resp), { status: 201 }));

    const out = await mintWithSetupCode(VALID_CODE);

    expect(spy).toHaveBeenCalledTimes(1);
    const [path, init] = spy.mock.calls[0] ?? [];
    expect(path).toBe('/bootstrap/mint');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ setup_code: VALID_CODE }));
    expect(out).toEqual(resp);
  });

  it('throws ApiError on 404 (uniform mint refusal per 04 §6.5)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/not_found', title: 'Not Found', status: 404 }),
        { status: 404 },
      ),
    );
    await expect(mintWithSetupCode(VALID_CODE)).rejects.toMatchObject({
      status: 404,
      problem: { type: '/problems/not_found' },
    });
  });

  it('propagates a network rejection as the original error', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(netErr);
    await expect(mintWithSetupCode(VALID_CODE)).rejects.toBe(netErr);
  });
});

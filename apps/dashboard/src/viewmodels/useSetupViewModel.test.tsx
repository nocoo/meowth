import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useSetupViewModel, { isHttpLoopbackOrigin } from './useSetupViewModel';

const TOKEN_KEY = 'meowth_token';
const VALID_TOKEN = `mwt_${'A'.repeat(39)}`;
const VALID_CODE = `mws_${'B'.repeat(39)}`;
const MINT_RESPONSE_SECRET = `mwt_${'C'.repeat(39)}`;

const navigateSpy = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

function wrap(initialEntries: MemoryRouterProps['initialEntries'] = ['/setup']) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

beforeEach(() => {
  navigateSpy.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useSetupViewModel — initial state and mode switching', () => {
  it('starts in token mode with an idle status and disables mint on a non-loopback origin (Vite dev)', () => {
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://meowth-vite.dev.hexly.ai' }),
      {
        wrapper: wrap(),
      },
    );
    expect(result.current.mode).toBe('token');
    expect(result.current.status.kind).toBe('idle');
    expect(result.current.mintDisabled).toBe(true);
    expect(result.current.mintDisabledReason).toContain('127.0.0.1:7040');
  });

  it('enables mint when origin is HTTP loopback (production embed / e2e fixture)', () => {
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    expect(result.current.mintDisabled).toBe(false);
    expect(result.current.mintDisabledReason).toBeNull();
  });

  it('disables mint when origin is Caddy HTTPS (meowth.dev.hexly.ai)', () => {
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'https://meowth.dev.hexly.ai' }),
      {
        wrapper: wrap(),
      },
    );
    expect(result.current.mintDisabled).toBe(true);
    expect(result.current.mintDisabledReason).toContain('Caddy HTTPS');
  });

  it('enables mint on the embed-mint e2e fixture port (http://127.0.0.1:17041)', () => {
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:17041' }),
      {
        wrapper: wrap(),
      },
    );
    expect(result.current.mintDisabled).toBe(false);
  });

  it('setMode switches between token and mint and clears any error', () => {
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => {
      result.current.setMode('mint');
    });
    expect(result.current.mode).toBe('mint');
    expect(result.current.status.kind).toBe('idle');
    act(() => {
      result.current.setMode('token');
    });
    expect(result.current.mode).toBe('token');
  });
});

describe('useSetupViewModel.submitToken', () => {
  it('rejects an empty input without touching localStorage or fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    await act(async () => {
      await result.current.submitToken('   ');
    });
    expect(result.current.status.kind).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('rejects a short bearer (fails the strict mwt_ + 39 base32 regex)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    await act(async () => {
      await result.current.submitToken('mwt_ABC');
    });
    expect(result.current.status.kind).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-base32 character such as `0` in the suffix', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    const bad = `mwt_${'0'.repeat(39)}`; // 0 is not in RFC4648 base32 (A-Z2-7)
    await act(async () => {
      await result.current.submitToken(bad);
    });
    expect(result.current.status.kind).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on a 200 from /v1/agents, stores token and navigates to /overview', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ agents: [] }), { status: 200 }),
    );
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(VALID_TOKEN);
    expect(navigateSpy).toHaveBeenCalledWith('/overview', { replace: true });
  });

  it('on a 401 from /v1/agents, clears token, stays on /setup, surfaces invalid-token error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/rejected/i);
    } else {
      throw new Error(`expected error status, got ${result.current.status.kind}`);
    }
  });

  it('on a network rejection, keeps token stored and shows daemon-unreachable (not redirect)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(VALID_TOKEN);
    expect(navigateSpy).not.toHaveBeenCalled();
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/unreachable/i);
    } else {
      throw new Error(`expected error status, got ${result.current.status.kind}`);
    }
  });
});

describe('useSetupViewModel.submitMint', () => {
  it('refuses to fire fetch when mint is disabled by non-loopback origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://meowth-vite.dev.hexly.ai' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => {
      result.current.setMode('mint');
    });
    await act(async () => {
      await result.current.submitMint(VALID_CODE);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toContain('127.0.0.1:7040');
    } else {
      throw new Error(`expected error status, got ${result.current.status.kind}`);
    }
  });

  it('rejects an empty code without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => result.current.setMode('mint'));
    await act(async () => {
      await result.current.submitMint('');
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed setup-code (short or non-base32)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => result.current.setMode('mint'));
    await act(async () => {
      await result.current.submitMint(`mws_${'1'.repeat(39)}`); // 1 is not base32
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.status.kind).toBe('error');
  });

  it('on success, stores the returned secret and navigates to /overview', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'id-1',
          name: 'bootstrap',
          prefix: MINT_RESPONSE_SECRET.slice(0, 9),
          secret: MINT_RESPONSE_SECRET,
          created_at: '2026-06-22T00:00:00Z',
          created_via: 'first_run_mint',
        }),
        { status: 201 },
      ),
    );
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => result.current.setMode('mint'));
    await act(async () => {
      await result.current.submitMint(VALID_CODE);
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(MINT_RESPONSE_SECRET);
    expect(navigateSpy).toHaveBeenCalledWith('/overview', { replace: true });
  });

  it('on uniform 404, switches back to token mode with the unified message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/not_found', title: 'Not Found', status: 404 }),
        { status: 404 },
      ),
    );
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => result.current.setMode('mint'));
    await act(async () => {
      await result.current.submitMint(VALID_CODE);
    });
    expect(result.current.mode).toBe('token');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/Setup not available/);
    } else {
      throw new Error(`expected error status, got ${result.current.status.kind}`);
    }
  });

  it('on network rejection, surfaces daemon-unreachable and does not navigate', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(
      () => useSetupViewModel({ currentOrigin: 'http://127.0.0.1:7040' }),
      {
        wrapper: wrap(),
      },
    );
    act(() => result.current.setMode('mint'));
    await act(async () => {
      await result.current.submitMint(VALID_CODE);
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toMatch(/unreachable/i);
    } else {
      throw new Error(`expected error status, got ${result.current.status.kind}`);
    }
  });
});

describe('isHttpLoopbackOrigin (helper)', () => {
  const TRUE_ORIGINS = [
    'http://127.0.0.1:7040',
    'http://127.0.0.1:17041',
    'http://localhost:37040',
    'http://[::1]:7040',
  ];
  for (const o of TRUE_ORIGINS) {
    it(`accepts ${o}`, () => {
      expect(isHttpLoopbackOrigin(o)).toBe(true);
    });
  }

  const FALSE_ORIGINS = [
    'https://127.0.0.1:7040', // https disqualifies even on loopback
    'https://meowth.dev.hexly.ai', // Caddy
    'http://meowth-vite.dev.hexly.ai', // Vite via Caddy
    'http://192.168.1.10:7040', // LAN
    'http://example.com', // public
    'not a url at all', // unparseable
    '', // empty
  ];
  for (const o of FALSE_ORIGINS) {
    it(`rejects ${JSON.stringify(o)}`, () => {
      expect(isHttpLoopbackOrigin(o)).toBe(false);
    });
  }
});

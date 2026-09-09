import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTokensViewModel from './useTokensViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/tokens']}>{children}</MemoryRouter>;
}

const SECRET = `mwt_${'A'.repeat(39)}`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('useTokensViewModel', () => {
  it('lists tokens then opens / closes the create modal cleanly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tokens: [] }));
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    expect(result.current.modal.open).toBe(false);
    act(() => result.current.openCreateModal());
    expect(result.current.modal.open).toBe(true);
    act(() => result.current.closeCreateModal());
    expect(result.current.modal.open).toBe(false);
  });

  it('submitCreate happy path appends a sanitized view and reveals the secret', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ tokens: [] });
      // POST /v1/tokens
      return jsonResponse(
        {
          id: 'id-1',
          name: 'ci',
          prefix: SECRET.slice(0, 9),
          secret: SECRET,
          created_at: '2026-06-22T00:00:00Z',
          created_via: 'dashboard',
        },
        201,
      );
    });
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    act(() => result.current.openCreateModal());
    act(() => result.current.setCreateName('ci'));
    await act(async () => {
      await result.current.submitCreate();
    });
    if (result.current.modal.open && result.current.modal.phase === 'reveal') {
      expect(result.current.modal.createdSecret).toBe(SECRET);
    } else {
      throw new Error('expected reveal phase');
    }
    if (result.current.status.kind === 'ready') {
      const t = result.current.status.tokens[0];
      expect(t).toBeDefined();
      // Sanitized view drops `secret`.
      expect((t as { secret?: string }).secret).toBeUndefined();
      expect(t?.id).toBe('id-1');
      expect(t?.prefix.startsWith('mwt_')).toBe(true);
    } else {
      throw new Error('expected ready state');
    }
  });

  it('closing the modal clears createdSecret immediately', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ tokens: [] });
      return jsonResponse(
        {
          id: 'id-2',
          name: 'k',
          prefix: SECRET.slice(0, 9),
          secret: SECRET,
          created_at: '2026-06-22T00:00:00Z',
          created_via: 'dashboard',
        },
        201,
      );
    });
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    act(() => result.current.openCreateModal());
    act(() => result.current.setCreateName('k'));
    await act(async () => {
      await result.current.submitCreate();
    });
    act(() => result.current.closeCreateModal());
    expect(result.current.modal.open).toBe(false);
  });

  it('submitCreate rejects empty name without firing fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tokens: [] }));
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    const spy = vi.spyOn(globalThis, 'fetch');
    const before = spy.mock.calls.length;
    act(() => result.current.openCreateModal());
    await act(async () => {
      await result.current.submitCreate();
    });
    expect(spy.mock.calls.length).toBe(before);
    if (result.current.modal.open && result.current.modal.phase === 'error') {
      expect(result.current.modal.message).toMatch(/required/i);
    } else {
      throw new Error('expected error phase');
    }
  });

  it('refresh re-lists tokens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tokens: [] }));
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    const before = spy.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });

  it('ignores setCreateName and submitCreate while the modal is closed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tokens: [] }));
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    act(() => result.current.setCreateName('nope'));
    await act(async () => {
      await result.current.submitCreate();
    });
    expect(result.current.modal.open).toBe(false);
  });

  it('submitCreate surfaces a problem title and closes on 401', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ tokens: [] });
      return jsonResponse({ type: '/problems/x', title: 'Name taken', status: 409 }, 409);
    });
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    act(() => result.current.openCreateModal());
    act(() => result.current.setCreateName('ci'));
    await act(async () => {
      await result.current.submitCreate();
    });
    if (result.current.modal.open && result.current.modal.phase === 'error') {
      expect(result.current.modal.message).toBe('Name taken');
    } else {
      throw new Error('expected error phase');
    }
  });

  it('submitCreate closes the modal when create returns 401', async () => {
    window.localStorage.setItem('meowth_token', 'mwt_something');
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ tokens: [] });
      return jsonResponse(
        { type: '/problems/unauthorized', title: 'Unauthorized', status: 401 },
        401,
      );
    });
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    act(() => result.current.openCreateModal());
    act(() => result.current.setCreateName('ci'));
    await act(async () => {
      await result.current.submitCreate();
    });
    expect(result.current.modal.open).toBe(false);
  });

  it('revoke reloads the list; revoke errors surface a message', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ tokens: [] });
      if (call === 2) return jsonResponse({ ok: true });
      if (call === 3) return jsonResponse({ tokens: [] });
      return jsonResponse({ type: '/problems/x', title: 'still in use', status: 409 }, 409);
    });
    const { result } = renderHook(() => useTokensViewModel(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    await act(async () => {
      await result.current.revoke('id-1');
    });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    await act(async () => {
      await result.current.revoke('id-2');
    });
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    if (result.current.status.kind === 'error') {
      expect(result.current.status.message).toBe('still in use');
    }
  });
});

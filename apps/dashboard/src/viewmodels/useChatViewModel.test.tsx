import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useChatViewModel from './useChatViewModel';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>;
}

const AGENTS_OK_BODY = JSON.stringify({
  agents: [
    { type: 'claude', installed: true, executable: '/c', version: '1' },
    { type: 'codex', installed: true, executable: '/x', version: '1' },
    { type: 'pi', installed: false, executable: '', version: '' },
  ],
});

const AGENTS_NONE_BODY = JSON.stringify({
  agents: [
    { type: 'claude', installed: false, executable: '', version: '' },
    { type: 'codex', installed: false, executable: '', version: '' },
  ],
});

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  signal: AbortSignal | null;
}

function recordFetchCalls() {
  const calls: FetchCall[] = [];
  const spy = vi.spyOn(globalThis, 'fetch');
  return { calls, spy };
}

/**
 * Build a ReadableStream of NDJSON lines. Each item is a fully
 * formed envelope object; the stream encodes them with a
 * trailing `\n`. The stream auto-closes once the queue drains.
 */
function ndjsonStream(envelopes: readonly Record<string, unknown>[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= envelopes.length) {
        controller.close();
        return;
      }
      const line = `${JSON.stringify(envelopes[i])}\n`;
      controller.enqueue(encoder.encode(line));
      i += 1;
    },
  });
}

/**
 * Stream that delivers `initial` then stays open forever (until
 * the upstream signal aborts). Used to exercise cancel paths.
 */
function neverEndingStream(
  initial: readonly Record<string, unknown>[],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const env of initial) {
        controller.enqueue(encoder.encode(`${JSON.stringify(env)}\n`));
      }
      const onAbort = () => {
        controller.error(new DOMException('aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
  });
}

function envSessionStarted(sessionId = 'sid-1'): Record<string, unknown> {
  return {
    v: 1,
    seq: 0,
    ts: '2026-06-30T07:00:00Z',
    session_id: sessionId,
    type: 'session_started',
    payload: { backend: 'claude' },
  };
}

function envMessage(text = 'hi', seq = 1, sessionId = 'sid-1'): Record<string, unknown> {
  return {
    v: 1,
    seq,
    ts: '2026-06-30T07:00:01Z',
    session_id: sessionId,
    type: 'message',
    payload: { kind: 'text', content: text },
  };
}

function envStatusWithBsid(bsid: string, seq = 2, sessionId = 'sid-1'): Record<string, unknown> {
  return {
    v: 1,
    seq,
    ts: '2026-06-30T07:00:02Z',
    session_id: sessionId,
    type: 'message',
    payload: { kind: 'status', backend_session_id: bsid },
  };
}

function envSessionEnded(
  opts: { status: string; backendSessionId?: string; sessionId?: string; seq?: number } = {
    status: 'completed',
  },
): Record<string, unknown> {
  const { status, backendSessionId, sessionId = 'sid-1', seq = 9 } = opts;
  const payload: { status: string; backend_session_id?: string } = { status };
  if (backendSessionId !== undefined) payload.backend_session_id = backendSessionId;
  return {
    v: 1,
    seq,
    ts: '2026-06-30T07:00:03Z',
    session_id: sessionId,
    type: 'session_ended',
    payload,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useChatViewModel — agents loading tri-state', () => {
  it('initial render is agentsStatus.loading; transitions to ready with first installed agent selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(AGENTS_OK_BODY, { status: 200 }));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    expect(result.current.agentsStatus.kind).toBe('loading');
    expect(result.current.composer.canSend).toBe(false);
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    expect(result.current.selectedAgent).toBe('claude');
  });

  it('agentsStatus.error when /v1/agents rejects (non-401); canSend stays false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ type: '/problems/down', title: 'Daemon down', status: 503 }), {
        status: 503,
      }),
    );
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('error'));
    if (result.current.agentsStatus.kind !== 'error') throw new Error('expected error');
    expect(result.current.agentsStatus.message).toBe('Daemon down');
    expect(result.current.selectedAgent).toBeNull();
    expect(result.current.composer.canSend).toBe(false);
  });

  it('agentsStatus.ready with 0 installed → selectedAgent null + canSend false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(AGENTS_NONE_BODY, { status: 200 }),
    );
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    expect(result.current.selectedAgent).toBeNull();
    act(() => result.current.composer.setInput('hi'));
    expect(result.current.composer.canSend).toBe(false);
  });

  it('refresh that removes the previously-selected agent re-picks the first remaining installed one', async () => {
    const initial = JSON.stringify({
      agents: [
        { type: 'claude', installed: true, executable: '/c', version: '1' },
        { type: 'codex', installed: true, executable: '/x', version: '1' },
      ],
    });
    const afterRefresh = JSON.stringify({
      agents: [
        // claude no longer installed; codex stays.
        { type: 'claude', installed: false, executable: '', version: '' },
        { type: 'codex', installed: true, executable: '/x', version: '1' },
      ],
    });
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response(initial, { status: 200 }));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    expect(result.current.selectedAgent).toBe('claude');
    spy.mockResolvedValueOnce(new Response(afterRefresh, { status: 200 }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.selectedAgent).toBe('codex'));
    if (result.current.agentsStatus.kind !== 'ready') throw new Error('expected ready');
    expect(result.current.agentsStatus.agents.find((a) => a.type === 'claude')?.installed).toBe(
      false,
    );
  });

  it('refresh that leaves zero installed clears selectedAgent and locks canSend=false', async () => {
    const initial = JSON.stringify({
      agents: [{ type: 'claude', installed: true, executable: '/c', version: '1' }],
    });
    const afterRefresh = JSON.stringify({
      agents: [{ type: 'claude', installed: false, executable: '', version: '' }],
    });
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response(initial, { status: 200 }));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    expect(result.current.selectedAgent).toBe('claude');
    act(() => result.current.composer.setInput('hi'));
    expect(result.current.composer.canSend).toBe(true);
    spy.mockResolvedValueOnce(new Response(afterRefresh, { status: 200 }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.selectedAgent).toBeNull());
    expect(result.current.composer.canSend).toBe(false);
  });
});

describe('useChatViewModel — submit happy path', () => {
  async function setupReady() {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) {
        return new Response(AGENTS_OK_BODY, { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    return { calls, spy, result };
  }

  it('first-turn ExecRequest body omits resume_session_id and locks the §3.2 fields', async () => {
    const { calls, spy, result } = await setupReady();
    spy.mockImplementationOnce(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      return new Response(
        ndjsonStream([
          envSessionStarted('sid-1'),
          envMessage('hello world', 1),
          envSessionEnded({ status: 'completed', backendSessionId: 'bsid-1' }),
        ]),
        { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    });
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() =>
      expect(result.current.turns[result.current.turns.length - 1]?.status).toBe('completed'),
    );
    const execCall = calls.find((c) => c.url.endsWith('/v1/agents/claude/exec'));
    expect(execCall).toBeDefined();
    const body = JSON.parse(String(execCall?.init?.body));
    expect(Object.keys(body).sort()).toEqual(
      ['prompt', 'semantic_inactivity_timeout_ms', 'timeout_ms'].sort(),
    );
    expect(Object.hasOwn(body, 'resume_session_id')).toBe(false);
    expect(body.timeout_ms).toBe(600_000);
    expect(body.semantic_inactivity_timeout_ms).toBe(60_000);
    expect(result.current.resumeSessionId).toBe('bsid-1');
  });

  it('follow-up turn carries the previous session_ended backend_session_id as resume_session_id', async () => {
    const { calls, spy, result } = await setupReady();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      return new Response(
        ndjsonStream([
          envSessionStarted('sid-1'),
          envSessionEnded({ status: 'completed', backendSessionId: 'bsid-1' }),
        ]),
        { status: 200 },
      );
    });
    act(() => result.current.composer.setInput('first'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.resumeSessionId).toBe('bsid-1'));
    act(() => result.current.composer.setInput('second'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns.length).toBe(2));
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('completed'));
    const execCalls = calls.filter((c) => c.url.endsWith('/v1/agents/claude/exec'));
    expect(execCalls.length).toBe(2);
    const secondBody = JSON.parse(String(execCalls[1]?.init?.body));
    expect(secondBody.resume_session_id).toBe('bsid-1');
  });

  it('§3.3 red line: message.kind=status backend_session_id does NOT update resumeSessionId', async () => {
    const { calls, spy, result } = await setupReady();
    spy.mockImplementationOnce(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      return new Response(
        ndjsonStream([
          envSessionStarted('sid-1'),
          envStatusWithBsid('status-bsid', 1),
          // No session_ended → status envelope id must not leak.
        ]),
        { status: 200 },
      );
    });
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('network-aborted'));
    expect(result.current.resumeSessionId).toBeNull();
  });
});

describe('useChatViewModel — cancel / abort taxonomy', () => {
  it('cancel() is a no-op when no turn is streaming', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(AGENTS_OK_BODY, { status: 200 }));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    const before = result.current.turns;
    act(() => result.current.composer.cancel());
    expect(result.current.turns).toBe(before);
  });

  it('user Cancel → status aborted-by-client; composer unlocks for the next turn', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      if (!signal) throw new Error('expected signal on exec');
      return new Response(neverEndingStream([envSessionStarted('sid-1')], signal), {
        status: 200,
      });
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('streaming'));
    act(() => result.current.composer.cancel());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('aborted-by-client'));
    expect(result.current.resumeSessionId).toBeNull();
    // composer.canSend should be ready again once input is set.
    act(() => result.current.composer.setInput('next'));
    expect(result.current.composer.canSend).toBe(true);
  });

  it('stream closes without session_ended → status network-aborted; resumeSessionId unchanged', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      return new Response(ndjsonStream([envSessionStarted('sid-1'), envMessage('partial', 1)]), {
        status: 200,
      });
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('network-aborted'));
    expect(result.current.resumeSessionId).toBeNull();
  });

  it("daemon graceful shutdown delivers session_ended.status='aborted' → status 'aborted' (not network-aborted)", async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      return new Response(
        ndjsonStream([
          envSessionStarted('sid-1'),
          envSessionEnded({ status: 'aborted', backendSessionId: 'bsid-aborted' }),
        ]),
        { status: 200 },
      );
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('aborted'));
    expect(result.current.resumeSessionId).toBe('bsid-aborted');
  });

  it('cancelReason ref is reset between turns: user-cancel then happy submit → second turn ends completed (not inheriting aborted-by-client)', async () => {
    const { calls, spy } = recordFetchCalls();
    let execCallIndex = 0;
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      execCallIndex += 1;
      if (execCallIndex === 1) {
        if (!signal) throw new Error('expected signal');
        return new Response(neverEndingStream([envSessionStarted('sid-1')], signal), {
          status: 200,
        });
      }
      return new Response(
        ndjsonStream([
          envSessionStarted('sid-2'),
          envSessionEnded({ status: 'completed', backendSessionId: 'bsid-2' }),
        ]),
        { status: 200 },
      );
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('first'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('streaming'));
    act(() => result.current.composer.cancel());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('aborted-by-client'));
    act(() => result.current.composer.setInput('second'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns.length).toBe(2));
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('completed'));
    expect(result.current.resumeSessionId).toBe('bsid-2');
  });
});

describe('useChatViewModel — setSelectedAgent / reset', () => {
  it('setSelectedAgent during streaming aborts the in-flight stream and clears turns + resumeSessionId', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      if (!signal) throw new Error('expected signal');
      return new Response(neverEndingStream([envSessionStarted('sid-1')], signal), {
        status: 200,
      });
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('streaming'));
    const execCall = calls.find((c) => c.url.endsWith('/v1/agents/claude/exec'));
    expect(execCall?.signal).toBeDefined();
    act(() => result.current.setSelectedAgent('codex'));
    expect(result.current.turns).toEqual([]);
    expect(result.current.resumeSessionId).toBeNull();
    expect(result.current.selectedAgent).toBe('codex');
    await waitFor(() => expect(execCall?.signal?.aborted).toBe(true));
  });

  it('reset() during streaming aborts and clears but keeps selectedAgent', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      if (!signal) throw new Error('expected signal');
      return new Response(neverEndingStream([envSessionStarted('sid-1')], signal), {
        status: 200,
      });
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('streaming'));
    act(() => result.current.reset());
    expect(result.current.turns).toEqual([]);
    expect(result.current.resumeSessionId).toBeNull();
    expect(result.current.selectedAgent).toBe('claude');
  });
});

describe('useChatViewModel — error responses', () => {
  it('exec 503 → turn status failed; composer unlocks', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      return new Response(
        JSON.stringify({
          type: '/problems/backend_unavailable',
          title: 'Backend unavailable',
          status: 503,
        }),
        { status: 503 },
      );
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('failed'));
    act(() => result.current.composer.setInput('retry'));
    expect(result.current.composer.canSend).toBe(true);
  });

  it('exec 401 → AuthGate clears token; streaming turn is removed so the user sees a clean slate on return', async () => {
    window.localStorage.setItem('meowth_token', 'mwt_TESTTOKEN');
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      return new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      );
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('hi'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns.length).toBe(0));
    expect(window.localStorage.getItem('meowth_token')).toBeNull();
  });
});

describe('useChatViewModel — concurrent submit guard', () => {
  it('submit while already streaming is a no-op (only one exec fetch fires)', async () => {
    const { calls, spy } = recordFetchCalls();
    spy.mockImplementation(async (input, init) => {
      const url = String(input);
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      calls.push({ url, init: init as RequestInit | undefined, signal });
      if (url.endsWith('/v1/agents')) return new Response(AGENTS_OK_BODY, { status: 200 });
      if (!signal) throw new Error('expected signal');
      return new Response(neverEndingStream([envSessionStarted('sid-1')], signal), {
        status: 200,
      });
    });
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    act(() => result.current.composer.setInput('first'));
    act(() => result.current.composer.submit());
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('streaming'));
    // Second submit should not produce a second exec request.
    act(() => result.current.composer.setInput('second'));
    act(() => result.current.composer.submit());
    const execCalls = calls.filter((c) => c.url.endsWith('/v1/agents/claude/exec'));
    expect(execCalls.length).toBe(1);
    expect(result.current.turns.length).toBe(1);
  });
});

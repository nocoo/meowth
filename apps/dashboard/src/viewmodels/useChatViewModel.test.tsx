import type { Agent, Envelope } from '@/models/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useChatViewModel from './useChatViewModel';

const AGENTS: Agent[] = [
  { type: 'claude', installed: true, executable: '/c', version: '1' },
  { type: 'codex', installed: true, executable: '/x', version: '1' },
  { type: 'pi', installed: false, executable: '', version: '' },
];

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>;
}

function envelope(type: Envelope['type'], payload = {}, seq = 0): Envelope {
  return { v: 1, seq, ts: '2026-09-08T08:00:00Z', session_id: 'sid-1', type, payload };
}

function ended(status = 'completed', backendId = 'backend-1') {
  return envelope('session_ended', { status, backend_session_id: backendId }, 99);
}

function stream() {
  let writer: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  return {
    response: new Response(body),
    bytes: (bytes: Uint8Array) => writer.enqueue(bytes),
    send: (...events: Envelope[]) => {
      writer.enqueue(
        new TextEncoder().encode(`${events.map((e) => JSON.stringify(e)).join('\n')}\n`),
      );
    },
    close: () => writer.close(),
    error: (error: Error) => writer.error(error),
  };
}

function finished(...events: Envelope[]) {
  return new Response(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function problem(status: number, title: string) {
  return Response.json({ type: '/problems/test', title, status }, { status });
}

async function ready(agents = AGENTS) {
  const exec = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (String(input).endsWith('/v1/agents')) return Promise.resolve(Response.json({ agents }));
    return exec(String(input), init);
  });
  const hook = renderHook(() => useChatViewModel(), { wrapper });
  await waitFor(() => expect(hook.result.current.agentsStatus.kind).toBe('ready'));
  return { ...hook, exec, fetchMock };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('agent availability', () => {
  it('loads before enabling the first installed agent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ agents: AGENTS }));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    expect(result.current.agentsStatus.kind).toBe('loading');
    expect(result.current.composer.canSend).toBe(false);
    act(() => {
      result.current.newChat();
      result.current.composer.submit('Before ready');
      result.current.composer.cancel();
    });
    await waitFor(() => expect(result.current.selectedAgent).toBe('claude'));
    expect(result.current.composer.canSend).toBe(true);
    expect(result.current.turns).toEqual([]);
  });

  it('surfaces a failed availability probe and retries it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(problem(503, 'Daemon down'));
    const { result } = renderHook(() => useChatViewModel(), { wrapper });
    await waitFor(() =>
      expect(result.current.agentsStatus).toEqual({ kind: 'error', message: 'Daemon down' }),
    );
    fetchMock.mockResolvedValue(Response.json({ agents: AGENTS }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.selectedAgent).toBe('claude'));
  });

  it('keeps input unavailable when no agents are installed', async () => {
    const { result, exec } = await ready(AGENTS.map((agent) => ({ ...agent, installed: false })));
    act(() => {
      result.current.newChat();
      result.current.setSelectedAgent('pi');
      result.current.composer.submit('Cannot send');
    });
    expect(result.current.selectedAgent).toBeNull();
    expect(result.current.composer.canSend).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('retains a valid selection on refresh, then replaces an unavailable one', async () => {
    const { result, fetchMock } = await ready();
    const id = result.current.activeConversationId;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.agentsStatus.kind).toBe('ready'));
    expect(result.current.activeConversationId).toBe(id);
    fetchMock.mockResolvedValueOnce(Response.json({ agents: [AGENTS[1]] }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.selectedAgent).toBe('codex'));
    fetchMock.mockResolvedValueOnce(Response.json({ agents: [] }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.selectedAgent).toBeNull());
    expect(result.current.composer.canSend).toBe(false);
  });

  it('ignores availability responses after unmount', async () => {
    let resolve: (response: Response) => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, unmount } = renderHook(() => useChatViewModel(), { wrapper });
    unmount();
    await act(async () => resolve(Response.json({ agents: AGENTS })));
    expect(result.current.agentsStatus.kind).toBe('loading');
  });
});

describe('streaming and continuation', () => {
  it('sends the exact exec fields and takes resume IDs only from terminal envelopes', async () => {
    const { result, exec } = await ready();
    const reply = stream();
    exec.mockResolvedValueOnce(reply.response);
    act(() => result.current.composer.submit('First question'));
    expect(exec.mock.calls[0]?.[0]).toBe('/v1/agents/claude/exec');
    expect(JSON.parse(String(exec.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: 'First question',
      timeout_ms: 600_000,
      semantic_inactivity_timeout_ms: 60_000,
    });
    await act(async () =>
      reply.send(
        envelope('session_started', { backend_session_id: 'provisional-start' }),
        envelope('message', { kind: 'status', backend_session_id: 'provisional-status' }, 1),
        envelope('message', { kind: 'text', content: 'Hello' }, 2),
      ),
    );
    expect(result.current.turns[0]?.sessionId).toBe('sid-1');
    expect(result.current.resumeSessionId).toBeNull();
    expect(result.current.turns[0]?.status).toBe('streaming');
    await act(async () => {
      reply.send(ended());
      reply.close();
    });
    expect(result.current.resumeSessionId).toBe('backend-1');
    exec.mockResolvedValueOnce(finished(ended('completed', 'backend-2')));
    act(() => result.current.composer.submit('Follow up'));
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('completed'));
    expect(JSON.parse(String(exec.mock.calls[1]?.[1]?.body)).resume_session_id).toBe('backend-1');
    expect(result.current.resumeSessionId).toBe('backend-2');
  });

  it('decodes partial NDJSON and split multibyte UTF-8 without corrupting content', async () => {
    const { result, exec } = await ready();
    const reply = stream();
    exec.mockResolvedValueOnce(reply.response);
    act(() => result.current.composer.submit('Unicode'));
    const bytes = new TextEncoder().encode(
      `${JSON.stringify(envelope('message', { kind: 'text', content: '你好 🌸' }))}\n`,
    );
    const split = bytes.indexOf(0xe4) + 1;
    await act(async () => reply.bytes(bytes.slice(0, split)));
    expect(result.current.turns[0]?.envelopes).toHaveLength(0);
    await act(async () => reply.bytes(bytes.slice(split)));
    expect(result.current.turns[0]?.envelopes[0]?.payload).toEqual({
      kind: 'text',
      content: '你好 🌸',
    });
    await act(async () => {
      reply.send(ended());
      reply.close();
    });
    expect(result.current.turns[0]?.status).toBe('completed');
  });

  it('guards empty submissions and repeated sends before React rerenders', async () => {
    const { result, exec } = await ready();
    const reply = stream();
    exec.mockResolvedValueOnce(reply.response);
    act(() => {
      result.current.composer.submit(' \n ');
      result.current.composer.submit('First');
      result.current.composer.submit('Duplicate');
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.composer.canSend).toBe(false);
    await act(async () => {
      reply.send(ended());
      reply.close();
    });
  });

  it.each(['completed', 'failed', 'timeout', 'cancelled', 'aborted'])(
    'honors the daemon terminal status %s',
    async (status) => {
      const { result, exec } = await ready();
      exec.mockResolvedValueOnce(finished(ended(status)));
      act(() => result.current.composer.submit('Status check'));
      await waitFor(() => expect(result.current.turns[0]?.status).toBe(status));
      expect(result.current.turns[0]?.endedAt).not.toBeNull();
      expect(result.current.resumeSessionId).toBe('backend-1');
    },
  );

  it('reports incomplete EOF without trusting a provisional checkpoint', async () => {
    const { result, exec } = await ready();
    exec.mockResolvedValueOnce(
      finished(envelope('message', { kind: 'status', backend_session_id: 'wrong' })),
    );
    act(() => result.current.composer.submit('Incomplete'));
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('network-aborted'));
    expect(result.current.turns[0]?.error).toContain('before the response finished');
    expect(result.current.resumeSessionId).toBeNull();
  });
});

describe('conversation workspace', () => {
  it('switches agents in an empty conversation without creating unused history', async () => {
    const { result } = await ready();
    const id = result.current.activeConversationId;
    act(() => result.current.setSelectedAgent('codex'));
    expect(result.current.selectedAgent).toBe('codex');
    expect(result.current.activeConversationId).toBe(id);
    act(() => {
      result.current.setSelectedAgent('codex');
      result.current.setSelectedAgent('pi');
    });
    expect(result.current.selectedAgent).toBe('codex');
    act(() => result.current.newChat());
    expect(result.current.activeConversationId).not.toBe(id);
    expect(result.current.conversations).toHaveLength(0);
  });

  it('retains conversations, their agent, and their own resume checkpoint', async () => {
    const { result, exec } = await ready();
    exec.mockResolvedValueOnce(finished(ended('completed', 'claude-context')));
    act(() => result.current.composer.submit('  Alpha\n question  '));
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('completed'));
    const claudeId = result.current.activeConversationId as string;
    act(() => result.current.setSelectedAgent('codex'));
    expect(result.current.resumeSessionId).toBeNull();
    exec.mockResolvedValueOnce(finished(ended('completed', 'codex-context')));
    act(() => result.current.composer.submit('Beta question'));
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('completed'));
    expect(result.current.conversations).toHaveLength(2);
    act(() => result.current.setSearch('ALPHA'));
    expect(result.current.conversations.map((item) => item.title)).toEqual(['Alpha question']);
    act(() => result.current.setSearch('codex'));
    expect(result.current.conversations.map((item) => item.title)).toEqual(['Beta question']);
    act(() => result.current.selectConversation(claudeId));
    expect(result.current.selectedAgent).toBe('claude');
    expect(result.current.resumeSessionId).toBe('claude-context');
    expect(result.current.turns[0]?.userPrompt).toBe('  Alpha\n question  ');
    act(() => result.current.selectConversation('missing'));
    expect(result.current.activeConversationId).toBe(claudeId);
    act(() => result.current.newChat());
    expect(result.current.search).toBe('');
    expect(result.current.turns).toEqual([]);
    expect(result.current.conversations).toHaveLength(2);
  });

  it('keeps streams running in their owning conversations when another agent is active', async () => {
    const { result, exec, unmount } = await ready();
    const claude = stream();
    const codex = stream();
    exec.mockResolvedValueOnce(claude.response).mockResolvedValueOnce(codex.response);
    act(() => result.current.composer.submit('Claude work'));
    const claudeId = result.current.activeConversationId as string;
    act(() => result.current.setSelectedAgent('codex'));
    act(() => result.current.composer.submit('Codex work'));
    const codexId = result.current.activeConversationId as string;
    await act(async () => {
      claude.send(
        envelope('message', { kind: 'text', content: 'Only Claude' }),
        ended('completed', 'claude-context'),
      );
      claude.close();
      codex.send(envelope('message', { kind: 'text', content: 'Only Codex' }));
    });
    expect(result.current.turns[0]?.envelopes).toHaveLength(1);
    expect(result.current.turns[0]?.envelopes[0]?.payload).toEqual({
      kind: 'text',
      content: 'Only Codex',
    });
    expect(exec.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    act(() => result.current.selectConversation(claudeId));
    expect(result.current.turns[0]?.status).toBe('completed');
    expect(result.current.resumeSessionId).toBe('claude-context');
    act(() => result.current.selectConversation(codexId));
    expect(result.current.turns[0]?.status).toBe('streaming');
    unmount();
    expect(exec.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    codex.close();
  });
});

describe('stop, retry, and errors', () => {
  it('stops immediately before headers arrive and ignores a late response', async () => {
    const { result, exec } = await ready();
    let resolve: (response: Response) => void = () => undefined;
    exec.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => result.current.composer.cancel());
    act(() => result.current.composer.submit('Slow headers'));
    act(() => result.current.composer.cancel());
    expect(result.current.turns[0]?.status).toBe('aborted-by-client');
    expect(result.current.composer.canSend).toBe(true);
    expect(exec.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => resolve(finished(ended())));
    expect(result.current.turns[0]?.envelopes).toHaveLength(0);
    expect(result.current.resumeSessionId).toBeNull();
  });

  it('retries while an old reader unwinds without overwriting output or unlocking a new stream', async () => {
    const { result, exec } = await ready();
    const old = stream();
    const next = stream();
    exec.mockResolvedValueOnce(old.response).mockResolvedValueOnce(next.response);
    act(() => result.current.composer.submit('Retry this question'));
    await act(async () => old.send(envelope('session_started')));
    act(() => result.current.composer.cancel());
    const oldTurnId = result.current.turns[0]?.id;
    act(() => result.current.retry());
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.id).not.toBe(oldTurnId);
    await act(async () => {
      old.send(ended('failed', 'wrong-context'));
      old.close();
    });
    expect(result.current.turns[0]?.status).toBe('streaming');
    expect(result.current.turns[0]?.envelopes).toHaveLength(0);
    act(() => result.current.composer.submit('Must not run'));
    expect(exec).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.send(ended('completed', 'right-context'));
      next.close();
    });
    expect(result.current.resumeSessionId).toBe('right-context');
    expect(result.current.turns[0]?.status).toBe('completed');
  });

  it('retries from the preceding checkpoint and keeps earlier turns', async () => {
    const { result, exec } = await ready();
    exec
      .mockResolvedValueOnce(finished(ended('completed', 'good-checkpoint')))
      .mockResolvedValueOnce(finished(ended('failed', 'failed-checkpoint')))
      .mockResolvedValueOnce(finished(ended('completed', 'retried-checkpoint')));
    act(() => result.current.retry());
    expect(exec).not.toHaveBeenCalled();
    act(() => result.current.composer.submit('First'));
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('completed'));
    act(() => result.current.retry());
    expect(exec).toHaveBeenCalledTimes(1);
    act(() => result.current.composer.submit('Second'));
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('completed'));
    expect(result.current.turns.map((turn) => turn.userPrompt)).toEqual(['First', 'Second']);
    expect(JSON.parse(String(exec.mock.calls[2]?.[1]?.body)).resume_session_id).toBe(
      'good-checkpoint',
    );
  });

  it.each([new TypeError('disconnected'), new DOMException('disconnected', 'AbortError')])(
    'treats a transport rejection as connection loss: %s',
    async (error) => {
      const { result, exec } = await ready();
      exec.mockRejectedValueOnce(error);
      act(() => result.current.composer.submit('Network failure'));
      await waitFor(() => expect(result.current.turns[0]?.status).toBe('network-aborted'));
      expect(result.current.turns[0]?.error).toContain('Daemon unreachable');
      expect(result.current.composer.canSend).toBe(true);
    },
  );

  it('preserves an observed terminal envelope when the transport subsequently errors', async () => {
    const { result, exec } = await ready();
    const reply = stream();
    exec.mockResolvedValueOnce(reply.response);
    act(() => result.current.composer.submit('Terminal first'));
    await act(async () => reply.send(ended('aborted', 'saved-context')));
    await act(async () => reply.error(new TypeError('socket closed')));
    expect(result.current.turns[0]?.status).toBe('aborted');
    expect(result.current.turns[0]?.error).toBeUndefined();
    expect(result.current.resumeSessionId).toBe('saved-context');
  });

  it('surfaces HTTP errors as failed attempts that can be retried', async () => {
    const { result, exec } = await ready();
    exec.mockResolvedValueOnce(problem(503, 'Backend unavailable'));
    act(() => result.current.composer.submit('Server failure'));
    await waitFor(() => expect(result.current.turns[0]?.status).toBe('failed'));
    expect(result.current.turns[0]?.error).toBe('Backend unavailable');
    expect(result.current.composer.canSend).toBe(true);
  });

  it('clears expired authentication without leaving a running turn', async () => {
    window.localStorage.setItem('meowth_token', 'fixture-only');
    const { result, exec } = await ready();
    exec.mockResolvedValueOnce(problem(401, 'Unauthorized'));
    act(() => result.current.composer.submit('Expired session'));
    await waitFor(() => expect(window.localStorage.getItem('meowth_token')).toBeNull());
    expect(result.current.turns[0]?.status).toBe('failed');
    expect(result.current.turns[0]?.error).toContain('Sign in again');
  });
});

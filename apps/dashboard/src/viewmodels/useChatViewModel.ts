import { execAgent, fetchAgents } from '@/models/agents';
import type { AgentType } from '@/models/agents';
import {
  buildExecRequest,
  deriveTurnStatusFromEnvelopes,
  extractResumeSessionId,
  extractSessionId,
} from '@/models/chat';
import type { ChatTurn, ChatTurnStatus } from '@/models/chat';
import { decodeChunk } from '@/models/envelope';
import type { Agent, Envelope } from '@/models/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// docs/features/03 §5.4 + §3.5 + §3.3 — useChatViewModel.
//
// Pulls `/v1/agents` on mount, drives one streaming turn at a
// time over `execAgent()`, and exposes a single source of truth
// for ChatPage / ChatContent / ChatComposer (task #18).
//
// Layering rule (docs/architecture/06 §6.1): the viewmodel
// imports from `models/` only. `apiStream` / `lib/api.ts` is
// reached **through** `execAgent` so the transport / auth
// contract stays in one place.

export type ChatAgentsStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; agents: readonly Agent[] }
  | { kind: 'error'; message: string };

export interface ChatComposer {
  input: string;
  setInput(v: string): void;
  /**
   * `true` iff a turn can be submitted right now. Locked to:
   * `agentsStatus.kind === 'ready'` AND `selectedAgent !== null`
   * AND no turn is currently streaming AND `input.trim() !== ''`.
   */
  canSend: boolean;
  /** Start a new turn. No-op if `canSend === false`. */
  submit(): void;
  /**
   * Abort the streaming turn. No-op if the last turn is not
   * streaming. Sets the local terminal status to
   * `'aborted-by-client'` per §3.5; does NOT wait for a
   * terminal envelope.
   */
  cancel(): void;
}

export interface ChatViewModel {
  /** loading / ready / error tri-state for the `/v1/agents` probe. */
  agentsStatus: ChatAgentsStatus;
  /**
   * Currently selected backend. `null` whenever
   * `agentsStatus.kind !== 'ready'` OR the daemon reports zero
   * `installed === true` backends.
   */
  selectedAgent: AgentType | null;
  setSelectedAgent(t: AgentType): void;
  /** Append-only within a Chat session. Cleared by switch/reset. */
  turns: readonly ChatTurn[];
  /**
   * Resume id for the next turn. Tracks the most recent
   * terminal-envelope turn's `backendSessionId`. **Not** cleared
   * by `aborted-by-client` / `network-aborted` so the user can
   * retry without losing conversation context.
   */
  resumeSessionId: string | null;
  composer: ChatComposer;
  /** Abort any streaming turn + clear turns/resume. selectedAgent stays. */
  reset(): void;
  /** Re-pull `/v1/agents`. Does not touch turns. */
  refresh(): void;
}

/**
 * Internal reason recorded the moment a controller is aborted.
 * `'user'` → falls into `'aborted-by-client'` in catch.
 * `'switch' | 'reset'` → the turn is being discarded; catch
 * does not try to re-write a removed turn.
 * `null` → not a viewmodel-initiated abort; AbortError gets
 * mapped to `'network-aborted'`.
 */
type CancelReason = 'user' | 'switch' | 'reset' | null;

function pickInitialAgent(agents: readonly Agent[]): AgentType | null {
  return agents.find((a) => a.installed)?.type ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextTurnAfterEnvelopes(prev: ChatTurn, batch: readonly Envelope[]): ChatTurn {
  if (batch.length === 0) return prev;
  const envelopes = [...prev.envelopes, ...batch];
  const sessionId = prev.sessionId ?? extractSessionId(envelopes);
  return { ...prev, envelopes, sessionId };
}

function finalizeTurnFromStream(prev: ChatTurn): {
  next: ChatTurn;
  newResumeId: string | null;
  isTerminalEnvelope: boolean;
} {
  const derived = deriveTurnStatusFromEnvelopes(prev.envelopes);
  if (derived !== null) {
    const backendSessionId = derived.backendSessionId ?? extractResumeSessionId(prev.envelopes);
    const next: ChatTurn = {
      ...prev,
      status: derived.status,
      backendSessionId,
      endedAt: nowIso(),
    };
    return { next, newResumeId: backendSessionId, isTerminalEnvelope: true };
  }
  // Stream closed without delivering session_ended — §3.5 second
  // branch (network drop / daemon shutdown without flush).
  const next: ChatTurn = { ...prev, status: 'network-aborted', endedAt: nowIso() };
  return { next, newResumeId: null, isTerminalEnvelope: false };
}

function abortedTurn(prev: ChatTurn, status: ChatTurnStatus): ChatTurn {
  return { ...prev, status, endedAt: nowIso() };
}

function isLastTurnStreaming(turns: readonly ChatTurn[]): boolean {
  return turns.length > 0 && turns[turns.length - 1]?.status === 'streaming';
}

/**
 * Replace the last turn in `turns` with `next` (immutable). Used
 * everywhere setTurns is needed during a streaming turn so the
 * caller cannot drift a stale `prevTurns` reference.
 */
function replaceLastTurn(
  turns: readonly ChatTurn[],
  produce: (prev: ChatTurn) => ChatTurn,
): readonly ChatTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1] as ChatTurn;
  return [...turns.slice(0, -1), produce(last)];
}

export default function useChatViewModel(): ChatViewModel {
  const handleAuthError = useAuthErrorHandler();

  const [agentsStatus, setAgentsStatus] = useState<ChatAgentsStatus>({ kind: 'loading' });
  const [selectedAgent, setSelectedAgentState] = useState<AgentType | null>(null);
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [agentsNonce, setAgentsNonce] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const cancelReasonRef = useRef<CancelReason>(null);
  const submittingRef = useRef(false);

  // Mount + refresh probe of /v1/agents.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentsNonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setAgentsStatus({ kind: 'loading' });
    fetchAgents()
      .then((resp) => {
        if (cancelled) return;
        const agents = resp.agents;
        setAgentsStatus({ kind: 'ready', agents });
        // After a successful /v1/agents response, the previously
        // selected backend may have been uninstalled (or never
        // existed in this new snapshot). Keep it only if it is
        // still `installed === true`; otherwise fall back to the
        // first installed agent, or null when none remain. This
        // upholds the §5.4 contract that `selectedAgent` is null
        // iff the daemon currently exposes zero installed
        // backends, so `canSend` stays trustworthy after a
        // refresh.
        setSelectedAgentState((prev) => {
          if (prev !== null && agents.some((a) => a.type === prev && a.installed)) {
            return prev;
          }
          return pickInitialAgent(agents);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = handleAuthError(err);
        if (message !== null) setAgentsStatus({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError, agentsNonce]);

  const refresh = useCallback(() => {
    setAgentsNonce((n) => n + 1);
  }, []);

  /**
   * Abort the in-flight stream (if any) and record the reason so
   * the submit catch block knows whether to write a terminal
   * status into the turn (user / null) or to leave it alone
   * (switch / reset, where the turn list is about to be wiped).
   */
  const abortInFlight = useCallback((reason: Exclude<CancelReason, null>) => {
    const ctrl = controllerRef.current;
    if (ctrl !== null && !ctrl.signal.aborted) {
      cancelReasonRef.current = reason;
      ctrl.abort();
    }
  }, []);

  const reset = useCallback(() => {
    abortInFlight('reset');
    setTurns([]);
    setResumeSessionId(null);
  }, [abortInFlight]);

  const setSelectedAgent = useCallback(
    (t: AgentType) => {
      abortInFlight('switch');
      setTurns([]);
      setResumeSessionId(null);
      setSelectedAgentState(t);
    },
    [abortInFlight],
  );

  const cancel = useCallback(() => {
    if (!isLastTurnStreaming(turns)) return;
    abortInFlight('user');
  }, [abortInFlight, turns]);

  const submit = useCallback(() => {
    if (submittingRef.current) return;
    if (agentsStatus.kind !== 'ready') return;
    if (selectedAgent === null) return;
    if (input.trim() === '') return;
    if (isLastTurnStreaming(turns)) return;

    submittingRef.current = true;
    cancelReasonRef.current = null;

    const controller = new AbortController();
    controllerRef.current = controller;

    const userPrompt = input;
    const turnSnapshot: ChatTurn = {
      sessionId: null,
      backendSessionId: null,
      userPrompt,
      envelopes: [],
      status: 'streaming',
      startedAt: nowIso(),
      endedAt: null,
    };

    const resumeAtSubmit = resumeSessionId;
    setTurns((prev) => [...prev, turnSnapshot]);
    setInput('');

    const target = selectedAgent;

    void (async () => {
      try {
        const stream = await execAgent(
          target,
          buildExecRequest({ prompt: userPrompt, resumeSessionId: resumeAtSubmit }),
          { signal: controller.signal },
        );
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            const decoded = decodeChunk(buffer, text);
            buffer = decoded.remaining;
            if (decoded.envelopes.length > 0) {
              setTurns((prev) =>
                replaceLastTurn(prev, (p) => nextTurnAfterEnvelopes(p, decoded.envelopes)),
              );
            }
          }
        } finally {
          reader.releaseLock();
        }
        // Flush any tail bytes — decodeChunk swallows the last
        // line if it lacks a terminating newline, but the daemon
        // always terminates session_ended with `\n`. Still, call
        // decode with an empty stream=false to drain TextDecoder
        // state for the same defensiveness as Sessions detail.
        const tail = decoder.decode();
        if (tail.length > 0 || buffer.length > 0) {
          const decoded = decodeChunk(buffer, tail);
          buffer = decoded.remaining;
          if (decoded.envelopes.length > 0) {
            setTurns((prev) =>
              replaceLastTurn(prev, (p) => nextTurnAfterEnvelopes(p, decoded.envelopes)),
            );
          }
        }
        setTurns((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1] as ChatTurn;
          if (last.status !== 'streaming') return prev;
          const { next, newResumeId, isTerminalEnvelope } = finalizeTurnFromStream(last);
          if (isTerminalEnvelope && newResumeId !== null) {
            setResumeSessionId(newResumeId);
          }
          return [...prev.slice(0, -1), next];
        });
      } catch (err: unknown) {
        const reason = cancelReasonRef.current;
        if (reason === 'switch' || reason === 'reset') {
          // The turn list was just wiped; nothing to write back.
          return;
        }
        if (reason === 'user') {
          setTurns((prev) => replaceLastTurn(prev, (p) => abortedTurn(p, 'aborted-by-client')));
          return;
        }
        if (controller.signal.aborted) {
          // AbortError that we did not initiate via the ref —
          // treat as network-aborted so the UI suggests a retry
          // rather than offering a Sessions deep link.
          setTurns((prev) => replaceLastTurn(prev, (p) => abortedTurn(p, 'network-aborted')));
          return;
        }
        const message = handleAuthError(err);
        if (message === null) {
          // 401 already redirected; wipe the streaming turn so
          // the user sees a clean slate on return.
          setTurns((prev) => prev.slice(0, -1));
          return;
        }
        setTurns((prev) => replaceLastTurn(prev, (p) => abortedTurn(p, 'failed')));
      } finally {
        submittingRef.current = false;
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    })();
  }, [agentsStatus, selectedAgent, input, turns, resumeSessionId, handleAuthError]);

  const composer: ChatComposer = {
    input,
    setInput,
    canSend:
      agentsStatus.kind === 'ready' &&
      selectedAgent !== null &&
      !isLastTurnStreaming(turns) &&
      input.trim() !== '',
    submit,
    cancel,
  };

  return {
    agentsStatus,
    selectedAgent,
    setSelectedAgent,
    turns,
    resumeSessionId,
    composer,
    reset,
    refresh,
  };
}

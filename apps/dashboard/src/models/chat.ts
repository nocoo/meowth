import type { Envelope, ExecRequest } from './types';

// docs/features/03 commit #2 — Chat module pure types + helpers.
//
// This file is **pure**: no React, no fetch, no hooks, no DOM.
// It is consumed by `viewmodels/useChatViewModel.ts` (commit #3)
// and by the L1 single-file unit tests next door. Keeping the
// helpers free of side effects lets the viewmodel be wired
// against a real fetch later without redoing the contract
// reasoning.
//
// Authoritative contracts live in the feature doc:
//   - §3.2  ExecRequest body for a chat turn (fixed field set
//           below; user-tunable knobs are intentionally absent)
//   - §3.3  resume-session-id rule: ONLY read the final
//           `session_ended.payload.backend_session_id`. Never
//           fall back to `message.kind=status` (provisional) or
//           `session_started` (often empty on the first turn).
//   - §3.5  terminal status source-of-truth: envelope-delivered
//           statuses pass through verbatim; local statuses
//           (`aborted-by-client`, `network-aborted`) are owned
//           by the viewmodel and never inferred from envelopes.
//   - §5.4  `ChatTurn.status` 8-value union with per-value
//           source-of-truth comments.

// Fixed timeouts per §3.2. Chat V1 does not expose these to the
// user; they are policy constants of the Chat module itself.
export const CHAT_TIMEOUT_MS = 600_000;
export const CHAT_SEMANTIC_INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * Lifecycle status for a single Chat turn.
 *
 * Terminal value source-of-truth (matches §5.4):
 *   - `completed | failed | timeout` — stream delivered
 *     `session_ended` with that status (happy path / backend
 *     error / hard timeout).
 *   - `cancelled` — stream delivered
 *     `session_ended.status='cancelled'` (rare: daemon-driven
 *     cancel; Chat V1 does not trigger this path).
 *   - `aborted` — stream delivered
 *     `session_ended.status='aborted'` (e.g. daemon graceful
 *     shutdown that flushed the terminal envelope before
 *     closing the socket; mirrors the daemon-side status
 *     defined in architecture/02 §5.5). Distinct from
 *     `aborted-by-client` (no envelope, user pressed Cancel)
 *     and from `network-aborted` (no envelope, daemon /
 *     network died before flushing).
 *   - `aborted-by-client` — user pressed Cancel; the
 *     viewmodel called `AbortController.abort()`. Set locally
 *     **without** waiting for a terminal envelope. daemon
 *     still persists `cancelled` to SQLite; the UI offers a
 *     "view in Sessions" deep link (§3.5).
 *   - `network-aborted` — fetch rejected with a non-user-
 *     driven AbortError / disconnect / daemon shutdown
 *     mid-stream, and **no** terminal envelope was observed.
 *     Distinct from `aborted-by-client` so the UI can suggest a
 *     retry rather than a Sessions link, and distinct from
 *     `aborted` so the implementation cannot collapse "no
 *     envelope" into "envelope said aborted".
 */
export type ChatTurnStatus =
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'aborted'
  | 'aborted-by-client'
  | 'network-aborted';

/**
 * `ChatTurnStatus` narrowed to the seven terminal values. Helpers
 * that emit a status only when the turn has ended return this
 * type so the caller cannot accidentally write `'streaming'`
 * back into a finished turn.
 */
export type ChatTurnTerminalStatus = Exclude<ChatTurnStatus, 'streaming'>;

/** Daemon-side terminal statuses that the wire envelope can carry. */
const DAEMON_TERMINAL_STATUSES = [
  'completed',
  'failed',
  'timeout',
  'cancelled',
  'aborted',
] as const satisfies readonly ChatTurnTerminalStatus[];

type DaemonTerminalStatus = (typeof DAEMON_TERMINAL_STATUSES)[number];

function isDaemonTerminalStatus(value: unknown): value is DaemonTerminalStatus {
  return (
    typeof value === 'string' && (DAEMON_TERMINAL_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A single turn of the conversation. Covers both the streaming
 * window (`status === 'streaming'`) and every terminal state
 * (see `ChatTurnStatus`).
 */
export interface ChatTurn {
  /**
   * daemon-side session id (from `session_started.session_id`).
   * `null` for the tiny window between `submit()` and the first
   * `session_started` envelope; if the user aborts within that
   * window the turn ends without ever populating this field
   * (§3.5).
   */
  sessionId: string | null;
  /**
   * backend-side conversation id (from
   * `session_ended.payload.backend_session_id`). Populated only
   * after `session_ended` is observed on the stream; used as
   * the next turn's `resume_session_id` (§3.3). Stays `null` on
   * `aborted-by-client` / `network-aborted` paths because the
   * stream ended before the terminal envelope arrived.
   */
  backendSessionId: string | null;
  /** Verbatim user input that started this turn. */
  userPrompt: string;
  /** Every envelope in arrival order, unfiltered. */
  envelopes: readonly Envelope[];
  /** See `ChatTurnStatus` jsdoc for source-of-truth rules. */
  status: ChatTurnStatus;
  /** ISO timestamp captured when `submit()` runs. */
  startedAt: string;
  /** ISO timestamp captured when `status` leaves `streaming`. */
  endedAt: string | null;
}

/** Input to `buildExecRequest` — keeps the call site explicit. */
export interface BuildExecRequestInput {
  /** Raw user text for this turn. */
  prompt: string;
  /**
   * Resume id for a follow-up turn (output of
   * `extractResumeSessionId` from the previous turn). `null`
   * indicates the first turn; the produced `ExecRequest` then
   * **omits** the `resume_session_id` field entirely rather
   * than sending `null` / empty string (§3.2).
   */
  resumeSessionId: string | null;
}

/**
 * Construct the JSON body for `POST /v1/agents/{type}/exec` per
 * §3.2. The output is the exact wire shape — no extra keys.
 *
 * Field policy (locked to §3.2 — `cwd` / `custom_args` /
 * `mcp_config` / `system_prompt` / `thread_name` / `max_turns` /
 * `thinking_level` are forbidden on the Chat path and the unit
 * tests assert their absence):
 *   - `prompt`                          — always
 *   - `timeout_ms`                      — always (10 min)
 *   - `semantic_inactivity_timeout_ms`  — always (60 s)
 *   - `resume_session_id`               — only on follow-up
 *     turns; the property is **omitted** entirely on the first
 *     turn so the daemon-side default kicks in.
 */
export function buildExecRequest(input: BuildExecRequestInput): ExecRequest {
  const base: ExecRequest = {
    prompt: input.prompt,
    timeout_ms: CHAT_TIMEOUT_MS,
    semantic_inactivity_timeout_ms: CHAT_SEMANTIC_INACTIVITY_TIMEOUT_MS,
  };
  if (input.resumeSessionId !== null) {
    return { ...base, resume_session_id: input.resumeSessionId };
  }
  return base;
}

/**
 * Pull the daemon-side `session_id` out of the first
 * `session_started` envelope in the stream. Returns `null` if
 * no such envelope has arrived yet (the abort-before-
 * session_started window in §3.5).
 */
export function extractSessionId(envelopes: readonly Envelope[]): string | null {
  for (const env of envelopes) {
    if (env.type === 'session_started') {
      const id = env.session_id;
      return typeof id === 'string' && id.length > 0 ? id : null;
    }
  }
  return null;
}

/**
 * Pull the next turn's `resume_session_id` from the **last**
 * `session_ended` envelope in the stream (§3.3 red line). Any
 * `message.kind=status` envelope carrying a provisional
 * `backend_session_id` is intentionally ignored; ditto for
 * `session_started.payload.backend_session_id` which is often
 * the empty string on the first turn.
 *
 * Returns `null` if no `session_ended` envelope has arrived or
 * if its `payload.backend_session_id` is missing / not a
 * non-empty string.
 */
export function extractResumeSessionId(envelopes: readonly Envelope[]): string | null {
  for (let i = envelopes.length - 1; i >= 0; i -= 1) {
    const env = envelopes[i];
    if (env?.type !== 'session_ended') continue;
    const raw = readPayloadField(env, 'backend_session_id');
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return null;
  }
  return null;
}

/**
 * Derive the terminal status + backend session id from the
 * stream. Returns `null` when the stream has not delivered a
 * `session_ended` envelope yet — the viewmodel keeps the turn
 * in `'streaming'` (or applies a local `'aborted-by-client'` /
 * `'network-aborted'` per §3.5, which is **not** this helper's
 * concern).
 *
 * If the envelope's `payload.status` is something the daemon
 * has never advertised, the function returns `null` rather than
 * guessing. The viewmodel is responsible for handling that
 * defensively (e.g. falling back to `'failed'` once the
 * implementation lands); the helper refuses to make the
 * decision for it.
 */
export function deriveTurnStatusFromEnvelopes(
  envelopes: readonly Envelope[],
): { status: DaemonTerminalStatus; backendSessionId: string | null } | null {
  for (let i = envelopes.length - 1; i >= 0; i -= 1) {
    const env = envelopes[i];
    if (env?.type !== 'session_ended') continue;
    const rawStatus = readPayloadField(env, 'status');
    if (!isDaemonTerminalStatus(rawStatus)) return null;
    const rawId = readPayloadField(env, 'backend_session_id');
    const backendSessionId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
    return { status: rawStatus, backendSessionId };
  }
  return null;
}

/**
 * Read a named field from an envelope's `payload` without
 * tripping TS4111 (index-signature access must use bracket
 * notation) or biome's `useLiteralKeys` warning (which would
 * normally prefer dot access). Centralising the read keeps the
 * two strict-mode toolchains agreeing in exactly one place.
 */
function readPayloadField(env: Envelope, key: string): unknown {
  const payload = env.payload as Record<string, unknown> | null | undefined;
  return payload?.[key];
}

# Feature 15: Transient Assistant Progress

Status: Planned; contract shared before implementation.

## Purpose

Show public assistant text and safe activity while an execution is running.
Pi's canonical text stays buffered until an assistant message succeeds, so a
failed attempt cannot contaminate a later SDK retry. A preview is temporary;
only the existing completed session receipt can authorize final output.

## Protocol

Clients opt in with `X-Meowth-Stream-Progress: 1`. The daemon echoes that
header on supported streams. An older daemon ignores the header, allowing
clients to fall back to existing events without changing the request body.
Requests without the header retain their existing stream behavior.

The outer envelope remains version 1 with its existing `session_id`, `seq`,
and `type`. Progress uses `type=message` and the following payloads:

| Payload | Meaning |
| --- | --- |
| `kind=status, status=preview_start, message_id="1"` | Pi starts a new assistant attempt; replace the previous preview. |
| `kind=text-preview, content="...", message_id="1"` | Append protocol-public assistant text to this preview only. |
| `kind=status, status=preview_end, message_id="1"` | This assistant message succeeded; the session is still running. |
| `kind=status, status=preview_reset, message_id="1"` | Discard this preview. |
| `kind=status, status=thinking` | Provider reasoning activity, without its text. |
| `kind=status, status=tool_running` | Backend tool activity started, without arguments or labels. |
| `kind=status, status=tool_finished` | Backend tool activity ended; this does not assert tool success. |

`message_id` is an increasing decimal string scoped to the HTTP session.
Pi assigns it only on an explicit assistant `message_start`. It is not a
backend session ID or tool call ID. Deltas without that boundary are not
eligible for previews. Duplicate ends do not duplicate preview completion.

Pi emits sanitized previews before the canonical `kind=text` messages.
Clients keep separate preview and canonical accumulators, using only previews
for incremental Pi display when the header is acknowledged. Hermes already
streams public `agent_message_chunk` as `kind=text`; clients can preview those
deltas while accumulating the final candidate. Meowth does not interpret
application-specific JSON: the client extracts allowed display text and never
executes partial tool calls.

For opted-in streams, thinking and tool events become the safe statuses above;
raw logs and unknown status bodies are omitted. Existing `running`,
`in_progress`, and `retrying` statuses remain. Error receipts retain existing
failure semantics. Private reasoning is distinguishable only when the
upstream protocol labels it separately; text classified as assistant output
by the provider is not reclassified by heuristics.

The tool statuses still represent actual harness tool use: a client with
tools disabled must reject them just as it rejects `tool-use` or `tool-result`.
`tool_finished` retains the client's original tool-result boundary for
discarding prior planning output; removing private fields does not weaken
tool policy or change that boundary.

All preview and Pi text chunks, plus opted-in Hermes text chunks, are at most
64 KiB of raw UTF-8 at rune boundaries. Even sixfold JSON escaping leaves a
line below 512 KiB. Each emitted envelope is persisted before it is written
and immediately flushed. An upstream that does not emit text incrementally
cannot acquire token-level streaming through this transport.

## Lifecycle and Implementation

- `daemon/pkg/agent/agent.go`: optional execution flag, preview message type,
  and message-local ID.
- `daemon/pkg/agent/pi.go`: preview lifecycle beside the existing attempt
  buffers. Retry/error/non-success endings reset the preview; EOF never
  publishes unfinished text. Final settlement still waits for the process.
  Fatal errors, cancellation, timeout, usage deduplication, and SDK-owned
  retry behavior remain unchanged.
- `daemon/pkg/agent/message_pipe.go`: reuse the existing 64 KiB chunking for
  public text and previews without blocking the protocol reader.
- `daemon/pkg/agent/hermes.go`: bounded public text and early safe tool
  activity even when complete tool arguments are deferred. History replay
  remains excluded by the existing prompt boundary.
- `daemon/internal/server/handlers/exec.go` and `pump_runner.go`: header
  negotiation and per-execution flag propagation.
- `daemon/internal/server/exec_pump.go` and
  `daemon/internal/envelope/envelope.go`: safe opted-in projection on both
  normal and drain paths, with unchanged sequence, persistence, and terminal
  rules. Progress remains an audit event, never canonical assistant output.
- `daemon/internal/server/openapi.yaml` and generated
  `packages/shared/src/openapi-types.ts`: header and payload documentation.

Success of one assistant message does not validate a later unfinished
message or a nonzero CLI exit. A failure after `preview_end` still invalidates
the preview. Clients discard all transient state on a non-completed terminal,
disconnect, cancellation, request replacement, or account retirement.
Preview latency and canonical first-text latency are separate measurements.

The registered backends are Claude, Codex, Copilot, Hermes, and Pi. There is
no standalone Grok adapter. A Grok model selected through Pi has Pi's event
semantics; this feature adds no model defaults or provider integration.

## Atomic Commit Plan

1. `docs: define opt-in assistant progress`: this contract and entry links.
2. `feat: stream transient assistant progress`: implementation, generated
   contract, and deterministic adapter/HTTP regressions for this capability.

## 6DQ Quality Plan

- G1: format, targeted Go vet/lint, and shared/dashboard type checks.
- L1: fake Pi lifecycle and retry sequences, private thinking/tool projection,
  UTF-8 and encoded-line limits, default-off compatibility, and unchanged
  canonical output/usage. Existing related adapter tests also run.
- L2: real loopback HTTP transport with a controlled fake backend; prove a
  flushed preview arrives before terminal completion, and verify persisted
  order plus failure/cancellation behavior. No model calls.
- G2: staged secret scan; use generated, non-private fixtures only.
- D1: temporary test homes and ports; do not replace the running daemon,
  its binary, CLI installations, provider configuration, or credentials.
- Delivery: record actual synthetic checks and their limits. Runtime changes
  require coordination with the client owner; this feature does not claim
  provider availability or outage recovery coverage.

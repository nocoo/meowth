# Feature 14: Pi Adapter Resilience and Assistant Attempt Isolation

> Status: Approved & In Progress
> Driver: Pi (Herdr w3J:p3), reviewed by Codex
> Context: Co-evolution with teams-native 127-eval campaign (V39 cohort upstream 500 interruption analysis). Hardening Pi adapter against transient mid-stream errors and auto-retries.

## 1. Background & Problem

During the teams-native 127-eval run (V39 cohort), upstream transient errors (such as HTTP 500 connection aborts and transient TLS handshake errors during gateway rotation) triggered `stopReason: "error"` in assistant messages.
Although Pi SDK (`@earendil-works/pi-coding-agent` v0.85.1) has built-in auto-retry with exponential backoff (`settings.retry.enabled=true`, up to 3 retries), the daemon's Pi adapter (`daemon/pkg/agent/pi.go`) was terminating the run prematurely:
1. When an assistant message ended with `stopReason: "error"`, `pi.go` immediately dispatched a `MessageError` envelope to `session.Messages` and locked `finalStatus = "failed"`.
2. Teams-native client received the `MessageError` and instantly aborted/failed the task, tearing down the child process while Pi was in the middle of executing its automatic retry.
3. Even if Pi succeeded in a retry attempt, `finalStatus` was permanently marked `"failed"`.
4. Text emitted across failed attempts was streamed directly to `session.Messages`, resulting in concatenated corrupted text (partial failed JSON + retry JSON).
5. First-token semantic timing in Teams-native client starts on the first text token received.

## 2. Architecture & Design

### 2.1 Attempt-Scoped Text Buffering & Delivery
- **Per-attempt buffering**: Text deltas (`text_delta`) emitted during an assistant turn are buffered in memory and NOT immediately streamed as `MessageText`.
- **Inactivity keepalive**: To preserve semantic inactivity / progress detection without triggering early first-token semantic timestamps or streaming unverified partial outputs, emit non-sensitive progress indications (e.g. `MessageStatus{Type: MessageStatus, Status: "in_progress"}`) on incoming deltas or retry transitions.
- **Commit on Success**: When an assistant turn completes with genuine success (`message_end` without `stopReason == "error"` and no error payload), the buffered text is flushed to `session.Messages` as `MessageText` and appended to `output`.
- **Discard on Error/Retry**: If `message_end` or `turn_end` reports `stopReason: "error"` or an error payload, the buffered text of that failed attempt is cleanly discarded.
- **Immediate Streaming for Non-Text Events**: `tool_execution_start`, `tool_execution_end`, `thinking_delta`, and `status` continue to be streamed immediately.

### 2.2 Transient Error Stashing & Auto-Retry Handling
- **Stash, Do Not Fail Early**: When `message_end` or `turn_end` reports an error, stash the error message as `stashedError`. Do NOT emit `MessageError` yet, and do NOT permanently set `finalStatus = "failed"`.
- **Auto-retry tracking**:
  - `auto_retry_start`: Track active retry attempt and emit status/log (`MessageStatus{Status: "retrying"}`).
  - `auto_retry_end`: If `success: false`, record retry exhaustion error.
- **Explicit Success Proof**:
  - When a message completes successfully (assistant message with non-error stopReason, or clean `turn_end`), `stashedError` is cleared, and `hasSuccessfulTurn = true`.
- **Final Settlement (Post EOF & cmd.Wait)**:
  - If context was cancelled or timed out, report `aborted` or `timeout`.
  - If `cmd.Wait()` returned non-zero exit code: report `failed`.
  - If unrecoverable stdout read error occurred: report `failed`.
  - If `auto_retry_end` failed or `stashedError != ""` persists without genuine success proof: emit `MessageError` and report `failed`.
  - If genuinely successful and exit code 0: report `completed`.

### 2.3 Cumulative Token Usage & Retry Metadata
- Token usages across turns and retries are accumulated per model without manufacturing fake keys.
- Real retry count and timestamps are logged.

## 3. 6DQ Quality Plan

1. **Deterministic / Zero-Leak**:
   - Temporary system prompt files (0600, absolute path) are cleaned up in all exit paths.
   - Child process is terminated on cancellation, timeout, or stdout read error.
2. **Regression & Safety**:
   - `error → retry → success`: Verifies failed attempt text is discarded, retry text is delivered, and status is completed.
   - `error → retry exhausted`: Verifies retry failure emits final error and marks failed.
   - `success followed by non-zero exit`: Verifies non-zero exit marks run failed.
   - `cancel / timeout`: Verifies child termination and cleanup.
   - `stdin/EOF & large inputs (>2MiB)`: Verifies existing large-input integrity is preserved.

## 4. Atomic Commit Plan

1. `docs(features): document Feature 14 Pi adapter resilience and assistant attempt isolation`
2. `fix(agent): isolate assistant attempt text buffering and defer transient error dispatch until retry settlement`
3. `test(agent): add comprehensive regression tests for Pi error-retry-success, retry exhaustion, and text isolation`

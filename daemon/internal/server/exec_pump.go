package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/nocoo/meowth/daemon/internal/envelope"
	"github.com/nocoo/meowth/daemon/internal/store"
	"github.com/nocoo/meowth/daemon/pkg/agent"
)

// pumpConfig collects the dependencies pumpAgentSession needs.
// All knobs (heartbeat interval, clock) are injectable so tests
// run without burning wall-clock.
type pumpConfig struct {
	DB                *sql.DB
	SessionID         string
	BackendType       string
	Session           *agent.Session
	Writer            http.ResponseWriter
	Flusher           http.Flusher
	Logger            *slog.Logger
	HeartbeatInterval time.Duration
	Now               func() time.Time
	// MarkPersistFailure is invoked when AppendMessage fails so
	// tests can observe the abort path without parsing logs.
	MarkPersistFailure func(error)
	// IsShutdown reports whether the cancel that fired this
	// pump's ctx came from daemon shutdown (CancelAll) rather
	// than a user-initiated POST /v1/sessions/{id}/cancel or
	// client disconnect. docs/architecture/02 §8.1 — shutdown
	// terminal status must be `aborted`, not `cancelled`. nil
	// is treated as "never shutdown" for tests that do not
	// exercise the shutdown path.
	IsShutdown func() bool
}

// defaultHeartbeatInterval is the docs/architecture/02 §5.7
// keep-alive cadence (15 s).
const defaultHeartbeatInterval = 15 * time.Second

// pumpResult reports the terminal state the pump reached. The
// daemon Cancel handler / startup shutdown logic both consult it.
type pumpResult struct {
	// Status the session ended with (one of docs/architecture/03
	// §6.2's terminal enum strings).
	Status string
	// Error message stored on the session row (empty on success).
	Error string
	// PersistErr is non-nil when an envelope INSERT failed; the
	// stream was closed without emitting session_ended, per
	// docs/architecture/03 §7.2.
	PersistErr error
}

// pumpAgentSession orchestrates the docs/architecture/02 §5 +
// docs/architecture/03 §7.2 contract for a single exec stream.
//
// On entry the caller has already:
//
//   - inserted the running session row (store.InsertSession);
//   - written `session_started` to the response;
//   - flushed once so the client sees the stream open.
//
// pumpAgentSession then reads agent.Message events, wraps each in
// an envelope, persists it with store.AppendMessage, and writes
// it to the HTTP response. Persist failure on ANY envelope short-
// circuits the stream (no further envelopes, including
// session_ended) per §7.2; the caller updates the session row to
// `failed`.
//
// On clean shutdown the pump emits a session_ended envelope and
// returns.
//
// Heartbeat: when the upstream is silent for `HeartbeatInterval`
// the pump injects a `heartbeat` envelope. Heartbeats also flush.
func pumpAgentSession(ctx context.Context, cfg pumpConfig) pumpResult {
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = defaultHeartbeatInterval
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	builder := envelope.NewBuilder(cfg.SessionID)
	// Account for the session_started already emitted by the
	// caller — bump the seq cursor past it.
	if _, err := builder.SessionStarted(cfg.Now(), envelope.SessionStartedPayload{}); err != nil {
		// builder.SessionStarted only fails on JSON marshal which
		// cannot fail on this struct; defensive bail.
		return pumpResult{
			Status:     string(store.SessionStatusFailed),
			Error:      fmt.Sprintf("pump: prime builder: %v", err),
			PersistErr: err,
		}
	}
	// The caller already emitted seq=0 (session_started). The
	// builder is now at seq=1.

	lastEmit := cfg.Now()
	heartbeatTicker := time.NewTicker(cfg.HeartbeatInterval)
	defer heartbeatTicker.Stop()

	// drainResult captures the terminal Result; it survives both
	// the normal "Messages closed first then Result delivered"
	// path and the ctx-cancellation path where the backend
	// produces a "cancelled" Result.
	var gotResult agent.Result
	var backendSessionID string

	for {
		select {
		case <-ctx.Done():
			// Client disconnect / cancel-endpoint fired. The
			// backend should observe ctx.Done and emit a
			// cancelled Result on its own; pump waits for it
			// briefly so the persisted session_ended carries the
			// real Result.Output / Result.Usage. If the backend
			// stalls, pump emits its own cancelled envelope
			// (best-effort).
			drainCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			res, ok := waitForResultOrTimeout(drainCtx, cfg.Session.Result)
			if ok {
				gotResult = res
			} else {
				gotResult = agent.Result{Status: "cancelled", Error: "client disconnected"}
			}
			return finalizeStream(cfg, builder, gotResult, backendSessionID, &lastEmit, logger)

		case <-heartbeatTicker.C:
			elapsed := cfg.Now().Sub(lastEmit)
			if elapsed < cfg.HeartbeatInterval {
				continue
			}
			env, err := builder.Heartbeat(cfg.Now(), envelope.HeartbeatPayload{
				SinceLastMessageMS: elapsed.Milliseconds(),
			})
			if err != nil {
				logger.Error("pump: build heartbeat", "err", err)
				continue
			}
			if perr := persistAndWrite(ctx, cfg, env, store.EventHeartbeat, logger); perr != nil {
				return abortStream(cfg, perr, logger)
			}
			lastEmit = cfg.Now()

		case msg, ok := <-cfg.Session.Messages:
			if !ok {
				// Messages channel closed: now wait for Result.
				drainCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				res, ok := waitForResultOrTimeout(drainCtx, cfg.Session.Result)
				if !ok {
					return finalizeStream(cfg, builder, agent.Result{Status: "failed", Error: "backend exited without a Result"}, backendSessionID, &lastEmit, logger)
				}
				gotResult = res
				return finalizeStream(cfg, builder, gotResult, backendSessionID, &lastEmit, logger)
			}
			// Record the first non-empty backend session id so
			// the session row can be updated with the resume
			// pointer (per 02 §5.2 / §5.3).
			if msg.SessionID != "" && backendSessionID == "" {
				backendSessionID = msg.SessionID
				if err := store.UpdateSessionBackendSessionID(ctx, cfg.DB, cfg.SessionID, backendSessionID); err != nil {
					logger.Warn("pump: backend_session_id update failed", "err", err)
				}
			}
			payload := messagePayloadFromAgent(msg)
			env, err := builder.Message(cfg.Now(), payload)
			if err != nil {
				logger.Error("pump: build message envelope", "err", err)
				continue
			}
			env, errPayload, truncated, terr := envelope.TruncateMessageContent(env)
			if terr != nil {
				logger.Error("pump: truncate message", "err", terr)
				continue
			}
			if perr := persistAndWrite(ctx, cfg, env, store.EventMessage, logger); perr != nil {
				return abortStream(cfg, perr, logger)
			}
			lastEmit = cfg.Now()
			if truncated {
				trunc, err := builder.Error(cfg.Now(), errPayload)
				if err != nil {
					logger.Error("pump: build truncation error envelope", "err", err)
				} else if perr := persistAndWrite(ctx, cfg, trunc, store.EventError, logger); perr != nil {
					return abortStream(cfg, perr, logger)
				}
			}
			if msg.Type == agent.MessageStatus {
				_ = msg.Type
			}

		case res, ok := <-cfg.Session.Result:
			if !ok {
				return finalizeStream(cfg, builder, agent.Result{Status: "failed", Error: "backend Result channel closed empty"}, backendSessionID, &lastEmit, logger)
			}
			gotResult = res
			// Drain any remaining buffered messages before
			// emitting session_ended. docs/architecture/03 §7.2:
			// if persisting any drained envelope fails, abort
			// the stream WITHOUT emitting session_ended.
			drainCtx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			perr := drainRemainingMessages(drainCtx, cfg, builder, &lastEmit, &backendSessionID, logger)
			cancel()
			if perr != nil {
				return abortStream(cfg, perr, logger)
			}
			return finalizeStream(cfg, builder, gotResult, backendSessionID, &lastEmit, logger)
		}
	}
}

// finalizeStream emits the docs/architecture/02 §5.5 session_ended
// envelope and updates the session row.
//
// If the pump's cancel came from daemon shutdown (cfg.IsShutdown
// returns true), the terminal status is overridden from whatever
// the backend reported (typically "cancelled") to "aborted" per
// docs/architecture/02 §8.1. User-initiated cancel (POST cancel
// or client disconnect) keeps "cancelled".
func finalizeStream(cfg pumpConfig, b *envelope.Builder, r agent.Result, backendSessionID string, lastEmit *time.Time, logger *slog.Logger) pumpResult {
	status := envelope.StatusFromAgentResult(r.Status)
	if cfg.IsShutdown != nil && cfg.IsShutdown() {
		// Override only when the backend returned a cancel-class
		// status; preserve genuine terminal states (completed /
		// failed / timeout) the backend already wrote before
		// shutdown landed.
		if status == "cancelled" || r.Status == "" {
			status = "aborted"
			if r.Error == "" {
				r.Error = "daemon shutdown"
			}
		}
	}
	bsID := backendSessionID
	if r.SessionID != "" {
		bsID = r.SessionID
		if backendSessionID == "" {
			if err := store.UpdateSessionBackendSessionID(context.Background(), cfg.DB, cfg.SessionID, bsID); err != nil {
				logger.Warn("pump: backend_session_id update (final) failed", "err", err)
			}
		}
	}
	usage := convertUsage(r.Usage)
	env, err := b.SessionEnded(cfg.Now(), envelope.SessionEndedPayload{
		Status:           status,
		OutputChars:      len(r.Output),
		Error:            r.Error,
		DurationMS:       r.DurationMs,
		BackendSessionID: bsID,
		Usage:            usage,
	})
	if err != nil {
		logger.Error("pump: build session_ended envelope", "err", err)
		return pumpResult{
			Status:     string(store.SessionStatusFailed),
			Error:      fmt.Sprintf("build session_ended: %v", err),
			PersistErr: err,
		}
	}
	if perr := persistAndWrite(context.Background(), cfg, env, store.EventSessionEnded, logger); perr != nil {
		return abortStream(cfg, perr, logger)
	}
	*lastEmit = cfg.Now()
	// Write the row update LAST so a successful stream commit is
	// visible on the session table after the stream finishes.
	usageJSON, err := json.Marshal(usage)
	if err != nil {
		logger.Error("pump: marshal usage_json", "err", err)
		usageJSON = []byte{}
	}
	if err := store.UpdateSessionEnded(context.Background(), cfg.DB, store.UpdateSessionEndedParams{
		ID:         cfg.SessionID,
		Status:     store.SessionStatus(status),
		EndedAt:    cfg.Now(),
		Error:      r.Error,
		DurationMS: r.DurationMs,
		UsageJSON:  usageJSON,
	}); err != nil {
		logger.Error("pump: UpdateSessionEnded failed", "err", err, "session_id", cfg.SessionID)
	}
	return pumpResult{Status: status, Error: r.Error}
}

// abortStream is the docs/architecture/03 §7.2 "persist failed"
// path: no further envelopes (including session_ended) reach the
// wire; sessions row goes to `failed`; stream is closed.
func abortStream(cfg pumpConfig, perr error, logger *slog.Logger) pumpResult {
	logger.Error("pump: persist failed; aborting stream", "err", perr, "session_id", cfg.SessionID)
	if cfg.MarkPersistFailure != nil {
		cfg.MarkPersistFailure(perr)
	}
	// Best-effort terminal row update — if this also fails, we
	// only log; the daemon log carries the trail.
	if err := store.UpdateSessionEnded(context.Background(), cfg.DB, store.UpdateSessionEndedParams{
		ID:         cfg.SessionID,
		Status:     store.SessionStatusFailed,
		EndedAt:    cfg.Now(),
		Error:      "persist failure: " + perr.Error(),
		DurationMS: 0,
	}); err != nil {
		logger.Error("pump: terminal row update after persist failure also failed", "err", err)
	}
	return pumpResult{
		Status:     string(store.SessionStatusFailed),
		Error:      perr.Error(),
		PersistErr: perr,
	}
}

// persistAndWrite is the canonical write order docs/architecture/03
// §7.2 mandates: INSERT first, THEN write to the HTTP response.
func persistAndWrite(ctx context.Context, cfg pumpConfig, env envelope.Envelope, eventType store.EventType, logger *slog.Logger) error {
	line, err := envelope.EncodeLine(env)
	if err != nil {
		return fmt.Errorf("encode line: %w", err)
	}
	if err := store.AppendMessage(ctx, cfg.DB, store.AppendMessageParams{
		SessionID:    cfg.SessionID,
		Seq:          env.Seq,
		EventType:    eventType,
		TS:           env.TS,
		EnvelopeJSON: line,
	}); err != nil {
		return fmt.Errorf("append message: %w", err)
	}
	if _, err := cfg.Writer.Write(line); err != nil {
		// Write failure means the client disconnected mid-stream.
		// docs/architecture/02 §4.4 treats this as an implicit
		// cancel — the row is already persisted; do NOT mark
		// abort here.
		logger.Warn("pump: response write failed (client likely disconnected)", "err", err)
		return nil
	}
	cfg.Flusher.Flush()
	return nil
}

func waitForResultOrTimeout(ctx context.Context, ch <-chan agent.Result) (agent.Result, bool) {
	select {
	case r, ok := <-ch:
		return r, ok
	case <-ctx.Done():
		return agent.Result{}, false
	}
}

// drainRemainingMessages drains buffered agent.Messages after the
// terminal Result arrives. Each drained message goes through the
// same persist-before-write path the main loop uses; returning an
// error here lets the caller route through abortStream so the
// docs/architecture/03 §7.2 "no further envelopes, including
// session_ended" rule still applies when persistence fails during
// drain.
//
// Truncation follow-up errors are emitted inline (same as the
// main loop), and a persist failure on either the message or its
// truncation-error envelope short-circuits the rest of the drain.
func drainRemainingMessages(ctx context.Context, cfg pumpConfig, b *envelope.Builder, lastEmit *time.Time, backendSessionID *string, logger *slog.Logger) error {
	for {
		select {
		case msg, ok := <-cfg.Session.Messages:
			if !ok {
				return nil
			}
			if msg.SessionID != "" && *backendSessionID == "" {
				*backendSessionID = msg.SessionID
				if err := store.UpdateSessionBackendSessionID(ctx, cfg.DB, cfg.SessionID, *backendSessionID); err != nil {
					logger.Warn("pump: backend_session_id update (drain) failed", "err", err)
				}
			}
			env, err := b.Message(cfg.Now(), messagePayloadFromAgent(msg))
			if err != nil {
				logger.Error("pump (drain): build message envelope", "err", err)
				continue
			}
			env, errPayload, truncated, terr := envelope.TruncateMessageContent(env)
			if terr != nil {
				logger.Error("pump (drain): truncate message", "err", terr)
				continue
			}
			if perr := persistAndWrite(ctx, cfg, env, store.EventMessage, logger); perr != nil {
				return perr
			}
			*lastEmit = cfg.Now()
			if truncated {
				trunc, err := b.Error(cfg.Now(), errPayload)
				if err != nil {
					logger.Error("pump (drain): build truncation error envelope", "err", err)
					continue
				}
				if perr := persistAndWrite(ctx, cfg, trunc, store.EventError, logger); perr != nil {
					return perr
				}
			}
		case <-ctx.Done():
			return nil
		}
	}
}

func messagePayloadFromAgent(m agent.Message) envelope.MessagePayload {
	return envelope.MessagePayload{
		Kind:             string(m.Type),
		Content:          m.Content,
		Tool:             m.Tool,
		CallID:           m.CallID,
		Input:            m.Input,
		Output:           m.Output,
		Status:           m.Status,
		Level:            m.Level,
		BackendSessionID: m.SessionID,
	}
}

func convertUsage(in map[string]agent.TokenUsage) map[string]envelope.UsagePerModel {
	if in == nil {
		return nil
	}
	out := make(map[string]envelope.UsagePerModel, len(in))
	for k, v := range in {
		out[k] = envelope.UsagePerModel{
			InputTokens:      v.InputTokens,
			OutputTokens:     v.OutputTokens,
			CacheReadTokens:  v.CacheReadTokens,
			CacheWriteTokens: v.CacheWriteTokens,
		}
	}
	return out
}

// errSentinelPersist makes go vet happy about the unused `errors`
// import when build tags exclude tests. Removing the import would
// regress on file refactors; leaving the sentinel here keeps the
// package consistent.
var errSentinelPersist = errors.New("pump: sentinel; not used at runtime") //nolint:unused,gochecknoglobals // see godoc

// runtimeWarn keeps the sync package alive for future spinning of
// background goroutines (cancel registry plumbing in handlers).
var _ sync.Locker = (*sync.Mutex)(nil) //nolint:gochecknoglobals,unused

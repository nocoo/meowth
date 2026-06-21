package server

import (
	"context"
	"sync"
)

// cancelRegistry holds the context.CancelFunc for every running
// exec stream so the cancel handler can find it by session id.
// docs/architecture/02 §6.5 + §7. The registry is process-local
// and does not survive a daemon restart — startup cleanup in
// store.MarkRunningSessionsAborted catches restart-orphans.
//
// The registry also tracks which sessions have already been
// asked to cancel so a second POST /v1/sessions/{id}/cancel
// returns 200 already_terminated (docs/architecture/02 §6.5
// idempotency) instead of re-firing the backend cancel and
// returning a fresh 202.
//
// docs/architecture/02 §8.1 also distinguishes user-initiated
// cancel from daemon shutdown: user cancel (POST /cancel or
// client disconnect) → terminal status `cancelled`; daemon
// shutdown → terminal status `aborted`. The registry tracks the
// shutdown flag per session so the pump's finalizeStream can
// override the backend's Result.Status when it returns.
type cancelRegistry struct {
	mu          sync.Mutex
	cancels     map[string]context.CancelFunc
	requested   map[string]struct{}
	shutdownIDs map[string]struct{}
}

// newCancelRegistry returns an empty registry.
func newCancelRegistry() *cancelRegistry {
	return &cancelRegistry{
		cancels:     make(map[string]context.CancelFunc),
		requested:   make(map[string]struct{}),
		shutdownIDs: make(map[string]struct{}),
	}
}

// Register stores a CancelFunc for the given session id. Returns
// the unregister function the caller MUST defer. Unregister also
// clears the requested / shutdown flags so a re-used session id
// (in tests only) starts clean.
func (r *cancelRegistry) Register(sessionID string, cancel context.CancelFunc) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cancels[sessionID] = cancel
	delete(r.requested, sessionID)
	delete(r.shutdownIDs, sessionID)
	return func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.cancels, sessionID)
		delete(r.requested, sessionID)
		delete(r.shutdownIDs, sessionID)
	}
}

// IsShutdown reports whether the session's cancel was initiated by
// daemon shutdown (CancelAll). The pump consults this when its
// context fires so it can override the terminal status to
// `aborted` instead of `cancelled`. Safe to call after the
// CancelFunc has been invoked — the entry is kept until the
// caller's defer-unregister runs at pump exit.
func (r *cancelRegistry) IsShutdown(sessionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.shutdownIDs[sessionID]
	return ok
}

// CancelOutcome captures what Cancel found in the registry.
type CancelOutcome int

const (
	// CancelOutcomeFired means the registered CancelFunc was
	// invoked. Caller should respond 202 cancelled.
	CancelOutcomeFired CancelOutcome = iota
	// CancelOutcomeAlreadyRequested means a previous cancel
	// request already fired this session's CancelFunc; the
	// caller should respond 200 already_terminated even if the
	// pump has not yet flipped the row.
	CancelOutcomeAlreadyRequested
	// CancelOutcomeUnknown means no CancelFunc is registered;
	// the caller falls back to the SQLite row state (terminal
	// → 200, missing → 404).
	CancelOutcomeUnknown
)

// Cancel attempts to cancel the session as user-initiated. The
// return value lets the HTTP handler distinguish first-time-fire
// (202) from a duplicate request (200 already_terminated) without
// consulting the SQLite row, which may lag the pump's exit. This
// path NEVER marks the session as a shutdown — only CancelAll
// does that.
func (r *cancelRegistry) Cancel(sessionID string) CancelOutcome {
	r.mu.Lock()
	cancel, ok := r.cancels[sessionID]
	if !ok {
		r.mu.Unlock()
		return CancelOutcomeUnknown
	}
	if _, alreadyRequested := r.requested[sessionID]; alreadyRequested {
		r.mu.Unlock()
		return CancelOutcomeAlreadyRequested
	}
	r.requested[sessionID] = struct{}{}
	r.mu.Unlock()
	cancel()
	return CancelOutcomeFired
}

// CancelAll is the docs/architecture/02 §8.1 shutdown path. Fires
// every registered CancelFunc that has NOT yet been requested AND
// marks each affected session as a shutdown so the pump's
// finalizeStream forces terminal status to `aborted`. Returns
// the number of new CancelFuncs fired so callers can log.
func (r *cancelRegistry) CancelAll() int {
	r.mu.Lock()
	pending := make([]context.CancelFunc, 0, len(r.cancels))
	for id, c := range r.cancels {
		if _, already := r.requested[id]; already {
			// Already user-cancelled; do not re-mark as shutdown.
			continue
		}
		r.requested[id] = struct{}{}
		r.shutdownIDs[id] = struct{}{}
		pending = append(pending, c)
	}
	r.mu.Unlock()
	for _, c := range pending {
		c()
	}
	return len(pending)
}

// IDs returns the currently-registered session ids. Used by the
// graceful-shutdown caller to update session rows after cancel.
func (r *cancelRegistry) IDs() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.cancels))
	for id := range r.cancels {
		out = append(out, id)
	}
	return out
}

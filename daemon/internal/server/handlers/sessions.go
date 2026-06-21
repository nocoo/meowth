package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// SessionsHandler serves the read-side session endpoints and the
// cancel mutation per docs/architecture/02 §6.2/§6.3/§6.4/§6.5.
type SessionsHandler struct {
	DB     *sql.DB
	Logger *slog.Logger
	// Cancel is the registry-backed cancel hook the handler calls
	// for a still-running session. The return value distinguishes
	// "first cancel — 202" from "already cancelled — 200
	// already_terminated" so the endpoint is idempotent even when
	// the pump has not yet flipped the session row.
	Cancel func(sessionID string) CancelOutcome
	Now    func() time.Time
}

// CancelOutcome mirrors server.cancelRegistry's CancelOutcome so
// the handlers package does not import the server package
// (avoiding the cycle). Numeric values match by convention; the
// server wiring sets Cancel to a thin adapter that converts.
type CancelOutcome int

const (
	// CancelOutcomeFired — first cancel; respond 202.
	CancelOutcomeFired CancelOutcome = iota
	// CancelOutcomeAlreadyRequested — second+ cancel during
	// pump teardown; respond 200 already_terminated.
	CancelOutcomeAlreadyRequested
	// CancelOutcomeUnknown — no live cancel registered; fall
	// back to the SQLite row.
	CancelOutcomeUnknown
)

// AgentsHandler serves GET /v1/agents per 02 §6.1.
type AgentsHandler struct {
	Factory agentfactory.Factory
	Logger  *slog.Logger
}

// sessionWire is the 02 §6.2 wire shape.
type sessionWire struct {
	ID               string  `json:"id"`
	BackendType      string  `json:"backend_type"`
	BackendSessionID string  `json:"backend_session_id"`
	Status           string  `json:"status"`
	StartedAt        string  `json:"started_at"`
	EndedAt          *string `json:"ended_at"`
	ThreadName       string  `json:"thread_name"`
	Model            string  `json:"model"`
}

func toWire(s store.Session) sessionWire {
	w := sessionWire{
		ID:               s.ID,
		BackendType:      string(s.BackendType),
		BackendSessionID: s.BackendSessionID,
		Status:           string(s.Status),
		StartedAt:        s.StartedAt.UTC().Format(time.RFC3339),
		ThreadName:       s.ThreadName,
		Model:            s.Model,
	}
	if !s.EndedAt.IsZero() {
		ended := s.EndedAt.UTC().Format(time.RFC3339)
		w.EndedAt = &ended
	}
	return w
}

// List handles GET /v1/sessions.
func (h *SessionsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	statuses, err := parseStatusFilter(q.Get("status"))
	if err != nil {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, err.Error(), r.URL.Path)
		return
	}
	limit, err := parseLimit(q.Get("limit"), 50, 1, 200)
	if err != nil {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, err.Error(), r.URL.Path)
		return
	}
	var before time.Time
	if v := q.Get("before"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "before must be RFC3339", r.URL.Path)
			return
		}
		before = t.UTC()
	}
	rows, err := store.ListSessions(r.Context(), h.DB, store.ListSessionsParams{
		Statuses: statuses, Limit: limit, Before: before,
	})
	if err != nil {
		h.logger().Error("sessions list failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	out := make([]sessionWire, 0, len(rows))
	for _, s := range rows {
		out = append(out, toWire(s))
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// Get handles GET /v1/sessions/{id}.
func (h *SessionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, err := store.GetSession(r.Context(), h.DB, id)
	if errors.Is(err, store.ErrSessionNotFound) {
		_ = problem.Write(w, http.StatusNotFound, problem.KindSessionNotFound, "session not found", r.URL.Path)
		return
	}
	if err != nil {
		h.logger().Error("sessions get failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	writeJSON(w, http.StatusOK, toWire(*s))
}

// Messages handles GET /v1/sessions/{id}/messages.
//
// 3.11b implements snapshot mode only. follow=true returns 400
// problem+json with a clear detail; follow lands in a 3.11
// follow-up commit per reviewer Q10.
func (h *SessionsHandler) Messages(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	q := r.URL.Query()
	if q.Get("follow") == "true" {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "follow=true is not implemented in this daemon version (snapshot only; tail follow is tracked under docs/architecture/02 §6.4)", r.URL.Path)
		return
	}
	if _, err := store.GetSession(r.Context(), h.DB, id); err != nil {
		if errors.Is(err, store.ErrSessionNotFound) {
			_ = problem.Write(w, http.StatusNotFound, problem.KindSessionNotFound, "session not found", r.URL.Path)
			return
		}
		h.logger().Error("messages: get session failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	afterSeq := int64(-1)
	if v := q.Get("after_seq"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "after_seq must be int", r.URL.Path)
			return
		}
		afterSeq = n
	}
	limit, err := parseLimit(q.Get("limit"), 1000, 1, 10000)
	if err != nil {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, err.Error(), r.URL.Path)
		return
	}
	typesFilter := parseTypesFilter(q.Get("types"))
	rows, err := store.ListMessagesAfterSeq(r.Context(), h.DB, store.ListMessagesAfterSeqParams{
		SessionID: id,
		AfterSeq:  afterSeq,
		Limit:     int64(limit + 1), // +1 to detect has_more
	})
	if err != nil {
		h.logger().Error("messages list failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	hasMore := false
	if int64(len(rows)) > int64(limit) {
		rows = rows[:limit]
		hasMore = true
	}
	events := make([]json.RawMessage, 0, len(rows))
	nextAfterSeq := afterSeq
	for _, row := range rows {
		if len(typesFilter) > 0 && !typesFilter[row.EventType] {
			nextAfterSeq = row.Seq
			continue
		}
		events = append(events, json.RawMessage(row.EnvelopeJSON))
		nextAfterSeq = row.Seq
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id":     id,
		"events":         events,
		"next_after_seq": nextAfterSeq,
		"has_more":       hasMore,
	})
}

// Cancel handles POST /v1/sessions/{id}/cancel per 02 §6.5.
//
//	first cancel on running session → 202 + {"id", "status":"cancelled"}
//	second+ cancel on still-running session → 200 + {"id", "status":"already_terminated"}
//	terminal row → 200 + {"id", "status":"already_terminated"}
//	unknown id → 404 + /problems/session_not_found
//
// Idempotency comes from the cancel registry: the second POST sees
// the cancel was already requested and skips re-firing the backend
// CancelFunc.
func (h *SessionsHandler) CancelHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, err := store.GetSession(r.Context(), h.DB, id)
	if errors.Is(err, store.ErrSessionNotFound) {
		_ = problem.Write(w, http.StatusNotFound, problem.KindSessionNotFound, "session not found", r.URL.Path)
		return
	}
	if err != nil {
		h.logger().Error("cancel: get session failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	if s.Status.IsTerminal() {
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "already_terminated"})
		return
	}
	// Row still running — consult the cancel registry to decide
	// fired-vs-already-requested.
	outcome := CancelOutcomeUnknown
	if h.Cancel != nil {
		outcome = h.Cancel(id)
	}
	switch outcome {
	case CancelOutcomeFired:
		writeJSON(w, http.StatusAccepted, map[string]any{"id": id, "status": "cancelled"})
	case CancelOutcomeAlreadyRequested:
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "already_terminated"})
	default:
		// No live cancel func: pump already exited but row not
		// yet flipped (race window). Treat as already_terminated.
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "already_terminated"})
	}
}

// List handles GET /v1/agents.
func (h *AgentsHandler) List(w http.ResponseWriter, r *http.Request) {
	type wire struct {
		Type       string `json:"type"`
		Installed  bool   `json:"installed"`
		Executable string `json:"executable"`
		Version    string `json:"version"`
	}
	rows := h.Factory.Agents()
	out := make([]wire, 0, len(rows))
	for _, r := range rows {
		out = append(out, wire{Type: r.Type, Installed: r.Installed, Executable: r.Executable, Version: r.Version})
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": out})
}

func (h *SessionsHandler) logger() *slog.Logger {
	if h.Logger != nil {
		return h.Logger
	}
	return slog.Default()
}

func parseStatusFilter(raw string) ([]store.SessionStatus, error) {
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]store.SessionStatus, 0, len(parts))
	for _, p := range parts {
		s := store.SessionStatus(strings.TrimSpace(p))
		switch s {
		case store.SessionStatusRunning, store.SessionStatusCompleted, store.SessionStatusFailed,
			store.SessionStatusAborted, store.SessionStatusTimeout, store.SessionStatusCancelled:
			out = append(out, s)
		default:
			return nil, errors.New("unknown status: " + string(s))
		}
	}
	return out, nil
}

func parseLimit(raw string, defaultVal, lo, hi int) (int, error) {
	if raw == "" {
		return defaultVal, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errors.New("limit must be int")
	}
	if n < lo || n > hi {
		return 0, errors.New("limit out of range")
	}
	return n, nil
}

func parseTypesFilter(raw string) map[store.EventType]bool {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make(map[store.EventType]bool, len(parts))
	for _, p := range parts {
		t := store.EventType(strings.TrimSpace(p))
		if t.IsValid() {
			out[t] = true
		}
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

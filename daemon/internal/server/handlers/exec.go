package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/envelope"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
	"github.com/nocoo/meowth/daemon/pkg/agent"
)

// ExecRunner is the interface the exec handler delegates the pump
// to. server.New supplies an implementation that calls the
// internal pumpAgentSession; tests can inject a stub.
type ExecRunner interface {
	Run(ctx context.Context, params ExecRunParams) ExecRunResult
}

// ExecRunParams collects the inputs for one exec stream.
type ExecRunParams struct {
	SessionID   string
	BackendType string
	Session     *agent.Session
	Writer      http.ResponseWriter
	Flusher     http.Flusher
	Logger      *slog.Logger
}

// ExecRunResult mirrors the pump's terminal pumpResult so the
// handler can decide whether to mark the session row failed for
// runtime persist errors.
type ExecRunResult struct {
	Status     string
	Error      string
	PersistErr error
}

// AgentExecHandler implements POST /v1/agents/{type}/exec per
// docs/architecture/02 §4. It does not own a goroutine; the
// handler runs the pump synchronously so cancel context flows
// through the HTTP request.
type AgentExecHandler struct {
	DB                *sql.DB
	Factory           agentfactory.Factory
	Runner            ExecRunner
	Logger            *slog.Logger
	RegisterCancel    func(sessionID string, cancel context.CancelFunc) (unregister func())
	HeartbeatInterval time.Duration
	Now               func() time.Time
}

// execRequest is the docs/architecture/02 §4.2 wire body.
type execRequest struct {
	Prompt                      string          `json:"prompt"`
	Cwd                         string          `json:"cwd,omitempty"`
	Model                       string          `json:"model,omitempty"`
	SystemPrompt                string          `json:"system_prompt,omitempty"`
	ThreadName                  string          `json:"thread_name,omitempty"`
	MaxTurns                    int             `json:"max_turns,omitempty"`
	TimeoutMS                   int64           `json:"timeout_ms,omitempty"`
	SemanticInactivityTimeoutMS int64           `json:"semantic_inactivity_timeout_ms,omitempty"`
	ResumeSessionID             string          `json:"resume_session_id,omitempty"`
	CustomArgs                  []string        `json:"custom_args,omitempty"`
	McpConfig                   json.RawMessage `json:"mcp_config,omitempty"`
	ThinkingLevel               string          `json:"thinking_level,omitempty"`
}

// Exec is the HTTP handler.
func (h *AgentExecHandler) Exec(w http.ResponseWriter, r *http.Request) {
	defer func() { _ = r.Body.Close() }()
	logger := h.logger()

	backendType := strings.ToLower(chi.URLParam(r, "type"))
	if !agent.IsSupportedType(backendType) {
		_ = problem.Write(w, http.StatusNotFound, problem.KindUnknownBackend, fmt.Sprintf("unknown agent type %q", backendType), r.URL.Path)
		return
	}

	var req execRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			_ = problem.Write(w, http.StatusRequestEntityTooLarge, problem.KindPayloadTooLarge, "request body exceeds the per-request size limit", r.URL.Path)
			return
		}
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "invalid JSON body", r.URL.Path)
		return
	}
	var sink json.RawMessage
	if err := dec.Decode(&sink); !errors.Is(err, io.EOF) {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "trailing data after JSON body", r.URL.Path)
		return
	}
	if l := len(strings.TrimSpace(req.Prompt)); l < 1 || l > 16384 {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "prompt must be 1..16384 chars", r.URL.Path)
		return
	}

	backend, err := h.Factory.New(backendType)
	if err != nil {
		switch {
		case errors.Is(err, agentfactory.ErrUnknownBackend):
			_ = problem.Write(w, http.StatusNotFound, problem.KindUnknownBackend, err.Error(), r.URL.Path)
			return
		case errors.Is(err, agentfactory.ErrBackendUnavailable):
			_ = problem.Write(w, http.StatusServiceUnavailable, problem.KindBackendUnavailable, err.Error(), r.URL.Path)
			return
		default:
			logger.Error("exec: factory error", "err", err, "type", backendType)
			_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
			return
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		logger.Error("exec: ResponseWriter does not implement Flusher", "type", backendType)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}

	id, err := uuid.NewV7()
	if err != nil {
		logger.Error("exec: uuid v7", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}
	sessionID := id.String()
	now := h.now()

	if _, err := store.InsertSession(r.Context(), h.DB, store.InsertSessionParams{
		ID:          sessionID,
		BackendType: store.BackendType(backendType),
		ThreadName:  req.ThreadName,
		Model:       req.Model,
		DaemonPID:   processPID(),
		StartedAt:   now,
	}); err != nil {
		logger.Error("exec: InsertSession failed", "err", err)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}

	// Build the cancellable child context. The cancel registry
	// receives it so POST /v1/sessions/{id}/cancel can pull the
	// CancelFunc by session id.
	execCtx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if h.RegisterCancel != nil {
		unreg := h.RegisterCancel(sessionID, cancel)
		defer unreg()
	}

	opts := agent.ExecOptions{
		Cwd:                       req.Cwd,
		Model:                     req.Model,
		SystemPrompt:              req.SystemPrompt,
		ThreadName:                req.ThreadName,
		MaxTurns:                  req.MaxTurns,
		Timeout:                   time.Duration(req.TimeoutMS) * time.Millisecond,
		SemanticInactivityTimeout: time.Duration(req.SemanticInactivityTimeoutMS) * time.Millisecond,
		ResumeSessionID:           req.ResumeSessionID,
		CustomArgs:                req.CustomArgs,
		McpConfig:                 req.McpConfig,
		ThinkingLevel:             req.ThinkingLevel,
	}

	sess, err := backend.Execute(execCtx, req.Prompt, opts)
	if err != nil {
		_ = store.UpdateSessionEnded(context.Background(), h.DB, store.UpdateSessionEndedParams{
			ID:      sessionID,
			Status:  store.SessionStatusFailed,
			EndedAt: h.now(),
			Error:   "backend.Execute: " + err.Error(),
		})
		logger.Error("exec: backend.Execute failed", "err", err, "type", backendType)
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "internal", r.URL.Path)
		return
	}

	// Stream headers (per 02 §4.3).
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// session_started envelope. Builder cursor advances inside
	// the pump (it primes its own builder past seq=0). We write
	// the seq=0 envelope here.
	builder := envelope.NewBuilder(sessionID)
	envStart, err := builder.SessionStarted(h.now(), envelope.SessionStartedPayload{
		BackendType: backendType,
		StartedAt:   now,
	})
	if err != nil {
		logger.Error("exec: build session_started", "err", err)
		return
	}
	line, err := envelope.EncodeLine(envStart)
	if err != nil {
		logger.Error("exec: encode session_started", "err", err)
		return
	}
	if err := store.AppendMessage(execCtx, h.DB, store.AppendMessageParams{
		SessionID:    sessionID,
		Seq:          envStart.Seq,
		EventType:    store.EventSessionStarted,
		TS:           envStart.TS,
		EnvelopeJSON: line,
	}); err != nil {
		logger.Error("exec: AppendMessage session_started failed", "err", err)
		_ = store.UpdateSessionEnded(context.Background(), h.DB, store.UpdateSessionEndedParams{
			ID:      sessionID,
			Status:  store.SessionStatusFailed,
			EndedAt: h.now(),
			Error:   "persist session_started: " + err.Error(),
		})
		return
	}
	if _, err := w.Write(line); err != nil {
		// Client gone before we wrote anything; just abort.
		logger.Warn("exec: client gone before session_started", "err", err)
		return
	}
	flusher.Flush()

	res := h.Runner.Run(execCtx, ExecRunParams{
		SessionID:   sessionID,
		BackendType: backendType,
		Session:     sess,
		Writer:      w,
		Flusher:     flusher,
		Logger:      logger,
	})
	_ = res
}

func (h *AgentExecHandler) logger() *slog.Logger {
	if h.Logger != nil {
		return h.Logger
	}
	return slog.Default()
}

func (h *AgentExecHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now().UTC()
}

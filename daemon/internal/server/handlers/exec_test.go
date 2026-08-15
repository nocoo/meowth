package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/envelope"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// stubRunner is a deterministic ExecRunner that the handler tests
// inject. Tests can assert which session id was streamed and force
// terminal results without spinning up the real pump.
type stubRunner struct {
	called   bool
	result   ExecRunResult
	captured ExecRunParams
}

func (r *stubRunner) Run(_ context.Context, p ExecRunParams) ExecRunResult {
	r.called = true
	r.captured = p
	// Emit a fake session_ended so the response body is sensible.
	b := envelope.NewBuilder(p.SessionID)
	_, _ = b.SessionStarted(time.Now(), envelope.SessionStartedPayload{})
	env, _ := b.SessionEnded(time.Now(), envelope.SessionEndedPayload{Status: "completed"})
	line, _ := envelope.EncodeLine(env)
	_, _ = p.Writer.Write(line)
	p.Flusher.Flush()
	return r.result
}

// chiRouterWithExec wraps the handler under the production route
// pattern so chi.URLParam(r, "type") returns the right value.
func chiRouterWithExec(h *AgentExecHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/v1/agents/{type}/exec", h.Exec)
	return r
}

func newExecFixture(t *testing.T) (*AgentExecHandler, *stubRunner) {
	t.Helper()
	db := newTestDB(t)
	runner := &stubRunner{result: ExecRunResult{Status: "completed"}}
	h := &AgentExecHandler{
		DB:      db,
		Factory: agentfactory.NewFake(),
		Logger:  slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Runner:  runner,
	}
	return h, runner
}

func TestExecRejectsUnknownBackendType(t *testing.T) {
	h, runner := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/godot/exec", bytes.NewBufferString(`{"prompt":"hi"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	var p problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Type != string(problem.KindUnknownBackend) {
		t.Fatalf("type = %q, want %q", p.Type, problem.KindUnknownBackend)
	}
	if runner.called {
		t.Fatal("runner ran for unknown backend")
	}
}

func TestExecRejectsEmptyPrompt(t *testing.T) {
	h, _ := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":""}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestExecRejectsWhitespaceOnlyPrompt(t *testing.T) {
	h, runner := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"   \n\t"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	var p problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(p.Detail, "non-whitespace") {
		t.Fatalf("detail = %q, want non-whitespace wording", p.Detail)
	}
	if runner.called {
		t.Fatal("runner must not run for whitespace-only prompt")
	}
}

func TestExecAcceptsPromptAboveFormer16kCap(t *testing.T) {
	// Field-level 16384 cap was Meowth-owned and not backed by HTTP body
	// limit (1 MiB) or capable backends. A prompt just over the old cap
	// must reach the fake backend.
	h, runner := newExecFixture(t)
	prompt := strings.Repeat("a", 16385)
	body, err := json.Marshal(map[string]string{"prompt": prompt})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !runner.called {
		t.Fatal("runner was not invoked for oversized-but-under-body-limit prompt")
	}
}

func TestExecRejectsNegativeTimeoutMS(t *testing.T) {
	h, runner := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec",
		bytes.NewBufferString(`{"prompt":"hi","timeout_ms":-1}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if runner.called {
		t.Fatal("runner must not run for negative timeout_ms")
	}
}

func TestExecRejectsNegativeMaxTurns(t *testing.T) {
	h, runner := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec",
		bytes.NewBufferString(`{"prompt":"hi","max_turns":-3}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if runner.called {
		t.Fatal("runner must not run for negative max_turns")
	}
}

func TestExecRejectsUnknownField(t *testing.T) {
	h, _ := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"hi","extra_field":"x"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestExecRejectsTrailingJSON(t *testing.T) {
	h, _ := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"hi"}{"a":1}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestExecRejectsBadCwd(t *testing.T) {
	// docs/architecture/02 §4.2 + §4.3: bad cwd is client input error →
	// 400 invalid_request, not a 500 from chdir inside backend.Execute.
	cases := []struct {
		name       string
		cwd        string
		wantDetail string
	}{
		{
			name:       "relative",
			cwd:        "not/a/real/path",
			wantDetail: "cwd must be an absolute path",
		},
		{
			name:       "missing",
			cwd:        filepath.Join(t.TempDir(), "does-not-exist"),
			wantDetail: "cwd does not exist:",
		},
		{
			name:       "file_not_dir",
			cwd:        writeTempFile(t),
			wantDetail: "cwd is not a directory:",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, runner := newExecFixture(t)
			body, err := json.Marshal(map[string]string{"prompt": "hi", "cwd": tc.cwd})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			rr := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			chiRouterWithExec(h).ServeHTTP(rr, r)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
			}
			var p problem.Body
			if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if p.Type != string(problem.KindInvalidRequest) {
				t.Fatalf("type = %q, want %q", p.Type, problem.KindInvalidRequest)
			}
			if !strings.Contains(p.Detail, tc.wantDetail) {
				t.Fatalf("detail = %q, want substring %q", p.Detail, tc.wantDetail)
			}
			if runner.called {
				t.Fatal("runner must not run for bad cwd")
			}
		})
	}
}

func TestExecAcceptsExistingAbsoluteCwd(t *testing.T) {
	h, runner := newExecFixture(t)
	dir := t.TempDir()
	body, err := json.Marshal(map[string]string{"prompt": "hi", "cwd": dir})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !runner.called {
		t.Fatal("runner was not invoked")
	}
}

func writeTempFile(t *testing.T) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "not-a-dir-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return path
}

func TestExecHappyPathWritesSessionStartedAndPersists(t *testing.T) {
	h, runner := newExecFixture(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"hi"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("content-type = %q", ct)
	}
	if !runner.called {
		t.Fatal("runner was not invoked")
	}
	// Body has at least the session_started + the stub's
	// session_ended.
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"type":"session_started"`)) {
		t.Fatalf("body missing session_started: %s", rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"type":"session_ended"`)) {
		t.Fatalf("body missing session_ended: %s", rr.Body.String())
	}
	// SQLite carries the session_started row.
	if n, err := store.CountMessagesForSession(context.Background(), h.DB, runner.captured.SessionID); err != nil || n < 1 {
		t.Fatalf("expected >=1 message rows, got %d (err=%v)", n, err)
	}
	if _, err := store.GetSession(context.Background(), h.DB, runner.captured.SessionID); err != nil {
		t.Fatalf("session row not present: %v", err)
	}
}

func TestExecProductionFactoryReturns503BackendUnavailable(t *testing.T) {
	// Production factory built with a deliberately-failing
	// resolver so we get ErrBackendUnavailable regardless of
	// what binaries happen to live on the test host's PATH.
	// docs/architecture/02 §4.3: supported type + binary not
	// usable → 503 /problems/backend_unavailable.
	db := newTestDB(t)
	prod := agentfactory.NewProduction()
	prod.Resolver = func(string) (string, error) {
		return "", errors.New("test: no backends installed")
	}
	h := &AgentExecHandler{
		DB:      db,
		Factory: prod,
		Logger:  slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Runner:  &stubRunner{result: ExecRunResult{Status: "completed"}},
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"hi"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	var p problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Type != string(problem.KindBackendUnavailable) {
		t.Fatalf("type = %q, want %q", p.Type, problem.KindBackendUnavailable)
	}
}

func TestExecRegistersCancelFunc(t *testing.T) {
	db := newTestDB(t)
	var registeredID string
	h := &AgentExecHandler{
		DB:      db,
		Factory: agentfactory.NewFake(),
		Logger:  slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Runner:  &stubRunner{result: ExecRunResult{Status: "completed"}},
		RegisterCancel: func(sessionID string, _ context.CancelFunc) func() {
			registeredID = sessionID
			return func() {}
		},
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/agents/claude/exec", bytes.NewBufferString(`{"prompt":"hi"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithExec(h).ServeHTTP(rr, r)
	if registeredID == "" {
		t.Fatal("RegisterCancel was not called")
	}
}

// silenceUnusedImports keeps test scaffolding compiling if a future
// edit drops one of the imports above.
var _ = errors.New
var _ = strings.TrimSpace

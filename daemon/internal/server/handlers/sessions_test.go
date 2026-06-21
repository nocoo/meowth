package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// newSessionsTestDB stands up an isolated test home + DB so the
// sessions handler tests can write rows directly via store.
func newSessionsTestDB(t *testing.T) *sql.DB {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	bs, err := sql.Open(store.DriverName(), "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := store.EnsureTestMarker(context.Background(), bs); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bs.Close()
	db, err := store.Open(context.Background(), h)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func mustSessUUID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	return id.String()
}

func seedSession(t *testing.T, db *sql.DB, id string, ttype store.BackendType, status store.SessionStatus) {
	t.Helper()
	now := time.Now().UTC()
	if _, err := store.InsertSession(context.Background(), db, store.InsertSessionParams{
		ID: id, BackendType: ttype, DaemonPID: 1, StartedAt: now,
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	if status != store.SessionStatusRunning {
		if err := store.UpdateSessionEnded(context.Background(), db, store.UpdateSessionEndedParams{
			ID: id, Status: status, EndedAt: now,
		}); err != nil {
			t.Fatalf("UpdateSessionEnded: %v", err)
		}
	}
}

func sessionsRouter(h *SessionsHandler) http.Handler {
	r := chi.NewRouter()
	r.Route("/v1/sessions", func(r chi.Router) {
		r.Get("/", h.List)
		r.Get("/{id}", h.Get)
		r.Get("/{id}/messages", h.Messages)
		r.Post("/{id}/cancel", h.CancelHandler)
	})
	return r
}

func TestSessionsListReturnsRowsOrdered(t *testing.T) {
	db := newSessionsTestDB(t)
	a, b, c := mustSessUUID(t), mustSessUUID(t), mustSessUUID(t)
	seedSession(t, db, a, store.BackendClaude, store.SessionStatusCompleted)
	time.Sleep(time.Second)
	seedSession(t, db, b, store.BackendClaude, store.SessionStatusRunning)
	time.Sleep(time.Second)
	seedSession(t, db, c, store.BackendClaude, store.SessionStatusFailed)
	h := &SessionsHandler{DB: db, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var body struct{ Sessions []map[string]any }
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Sessions) != 3 {
		t.Fatalf("rows = %d, want 3", len(body.Sessions))
	}
	if body.Sessions[0]["id"] != c {
		t.Fatalf("first id = %v, want %q", body.Sessions[0]["id"], c)
	}
}

func TestSessionsListFiltersByStatus(t *testing.T) {
	db := newSessionsTestDB(t)
	a, b := mustSessUUID(t), mustSessUUID(t)
	seedSession(t, db, a, store.BackendClaude, store.SessionStatusCompleted)
	seedSession(t, db, b, store.BackendClaude, store.SessionStatusRunning)
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions?status=running", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	var body struct{ Sessions []map[string]any }
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if len(body.Sessions) != 1 || body.Sessions[0]["id"] != b {
		t.Fatalf("filter wrong: %+v", body.Sessions)
	}
}

func TestSessionsListRejectsBadStatus(t *testing.T) {
	db := newSessionsTestDB(t)
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions?status=mystery", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestSessionsGetReturns404(t *testing.T) {
	db := newSessionsTestDB(t)
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/01900000-0000-7000-8000-000000000000", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rr.Code)
	}
	var p problem.Body
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	if p.Type != string(problem.KindSessionNotFound) {
		t.Fatalf("type = %q", p.Type)
	}
}

func TestSessionsCancelRunningReturns202(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusRunning)
	cancelled := false
	h := &SessionsHandler{DB: db, Cancel: func(string) CancelOutcome { cancelled = true; return CancelOutcomeFired }}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+id+"/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rr.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["status"] != "cancelled" || body["id"] != id {
		t.Fatalf("body = %+v", body)
	}
	if !cancelled {
		t.Fatal("Cancel callback not invoked")
	}
}

func TestSessionsCancelTerminalReturns200AlreadyTerminated(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusCompleted)
	h := &SessionsHandler{DB: db, Cancel: func(string) CancelOutcome { return CancelOutcomeUnknown }}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+id+"/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["status"] != "already_terminated" {
		t.Fatalf("status = %q, want already_terminated", body["status"])
	}
}

func TestSessionsCancelUnknownReturns404(t *testing.T) {
	db := newSessionsTestDB(t)
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/sessions/01900000-0000-7000-8000-000000000000/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rr.Code)
	}
}

func TestSessionsMessagesFollowTrueReturns400(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusRunning)
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+id+"/messages?follow=true", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for follow=true", rr.Code)
	}
}

func TestSessionsMessagesSnapshotReturnsEvents(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusCompleted)
	for i := 0; i < 3; i++ {
		if err := store.AppendMessage(context.Background(), db, store.AppendMessageParams{
			SessionID:    id,
			Seq:          int64(i),
			EventType:    store.EventMessage,
			TS:           time.Now().UTC(),
			EnvelopeJSON: []byte(`{"v":1}`),
		}); err != nil {
			t.Fatalf("AppendMessage[%d]: %v", i, err)
		}
	}
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+id+"/messages", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var body struct {
		SessionID    string            `json:"session_id"`
		Events       []json.RawMessage `json:"events"`
		NextAfterSeq int               `json:"next_after_seq"`
		HasMore      bool              `json:"has_more"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body.SessionID != id || len(body.Events) != 3 {
		t.Fatalf("snapshot wrong: %+v", body)
	}
	if body.HasMore {
		t.Fatal("has_more should be false")
	}
}

func TestSessionsMessagesAfterSeqFilters(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusCompleted)
	for i := 0; i < 5; i++ {
		_ = store.AppendMessage(context.Background(), db, store.AppendMessageParams{
			SessionID: id, Seq: int64(i), EventType: store.EventMessage,
			TS: time.Now().UTC(), EnvelopeJSON: []byte(`{"v":1}`),
		})
	}
	h := &SessionsHandler{DB: db}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+id+"/messages?after_seq=2", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	var body struct {
		Events []json.RawMessage `json:"events"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if len(body.Events) != 2 {
		t.Fatalf("len = %d, want 2", len(body.Events))
	}
}

func TestAgentsHandlerListsAllSupportedTypes(t *testing.T) {
	h := &AgentsHandler{Factory: agentfactory.NewFake()}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
	router := chi.NewRouter()
	router.Get("/v1/agents", h.List)
	router.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var body struct {
		Agents []map[string]any `json:"agents"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if len(body.Agents) != 5 {
		t.Fatalf("agents = %d", len(body.Agents))
	}
	for _, a := range body.Agents {
		if a["installed"] != true {
			t.Fatalf("fake mode all installed=true; got %v", a)
		}
	}
}

// TestSessionsCancelIsIdempotent locks the reviewer-cited contract:
// a second POST while the row is still running must return 200
// already_terminated, not another 202. The registry adapter
// reports CancelOutcomeAlreadyRequested for the second call.
func TestSessionsCancelIsIdempotent(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusRunning)
	calls := 0
	h := &SessionsHandler{DB: db, Cancel: func(string) CancelOutcome {
		calls++
		if calls == 1 {
			return CancelOutcomeFired
		}
		return CancelOutcomeAlreadyRequested
	}}
	rr1 := httptest.NewRecorder()
	r1 := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+id+"/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr1, r1)
	if rr1.Code != http.StatusAccepted {
		t.Fatalf("first cancel: status = %d, want 202", rr1.Code)
	}
	rr2 := httptest.NewRecorder()
	r2 := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+id+"/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr2, r2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("second cancel: status = %d, want 200 already_terminated", rr2.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rr2.Body.Bytes(), &body)
	if body["status"] != "already_terminated" {
		t.Fatalf("second cancel body status = %q", body["status"])
	}
	if calls != 2 {
		t.Fatalf("Cancel callback invocations = %d, want 2", calls)
	}
}

// TestSessionsCancelUnknownAdapterReturnsAlreadyTerminated covers
// the case where the row is still running but the pump exited
// before the registry was consulted (race window). The handler
// falls back to already_terminated rather than 202 cancelled.
func TestSessionsCancelUnknownAdapterReturnsAlreadyTerminated(t *testing.T) {
	db := newSessionsTestDB(t)
	id := mustSessUUID(t)
	seedSession(t, db, id, store.BackendClaude, store.SessionStatusRunning)
	h := &SessionsHandler{DB: db, Cancel: func(string) CancelOutcome { return CancelOutcomeUnknown }}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+id+"/cancel", nil)
	sessionsRouter(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["status"] != "already_terminated" {
		t.Fatalf("status = %q", body["status"])
	}
}

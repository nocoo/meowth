package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/server/auth"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// newTestServer provisions a fresh test home + DB + server.New chain
// for each test body. Returns the assembled *Server, the *sql.DB
// (so tests can seed tokens via store helpers), and a channel that
// fires once per successful bearer auth's async last_used_at update;
// tests that authenticate must drain it before the test ends so the
// async goroutine cannot race with DB cleanup.
func newTestServer(t *testing.T) (*Server, *sql.DB, chan struct{}) {
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
		t.Fatalf("bootstrap open: %v", err)
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

	touched := make(chan struct{}, 16)
	srv, err := New(Config{
		DB:     db,
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
		AuthConfig: auth.Config{
			DB:        db,
			TouchHook: func(string) { touched <- struct{}{} },
		},
	})
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	return srv, db, touched
}

// drainTouch is the standard "wait for one last_used_at goroutine to
// finish" helper. Tests that authenticate exactly once call this
// before letting db close at cleanup.
func drainTouch(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("TouchHook never fired within 2s")
	}
}

func insertToken(t *testing.T, db *sql.DB) (secret string, id string) {
	t.Helper()
	sec, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		t.Fatalf("GenerateTokenSecret: %v", err)
	}
	row, err := store.InsertToken(context.Background(), db, store.InsertTokenParams{
		Name:       "test",
		Prefix:     store.Prefix(sec),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaInit,
	})
	if err != nil {
		t.Fatalf("InsertToken: %v", err)
	}
	return sec, row.ID
}

func TestNewRejectsNilDB(t *testing.T) {
	if _, err := New(Config{DB: nil}); err == nil {
		t.Fatal("New accepted nil DB")
	}
}

func TestHealthzReturnsOKBooleanShape(t *testing.T) {
	// docs/architecture/02 §14: GET /healthz returns 200 + {"ok":true}.
	srv, _, _ := newTestServer(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("content-type = %q, want json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got, ok := body["ok"]
	if !ok {
		t.Fatalf("body missing `ok` key: %v", body)
	}
	if got != true {
		t.Fatalf("ok = %v, want true", got)
	}
	if _, hasStatus := body["status"]; hasStatus {
		t.Fatalf("body unexpectedly carries `status` key — 02 §14 mandates `ok` only: %v", body)
	}
}

func TestHealthzPassesThroughWithoutBearer(t *testing.T) {
	srv, _, _ := newTestServer(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (healthz must be auth-exempt)", rr.Code)
	}
}

func TestV1WithoutBearerReturnsUnauthorized(t *testing.T) {
	srv, _, _ := newTestServer(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("content-type = %q, want %q", ct, problem.ContentType)
	}
}

func TestV1RoutesAreFunctionalWithBearer(t *testing.T) {
	srv, db, touched := newTestServer(t)
	secret, _ := insertToken(t, db)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	r.Header.Set("Authorization", "Bearer "+secret)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Tokens []map[string]any `json:"tokens"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Tokens) != 1 {
		t.Fatalf("tokens length = %d, want 1", len(body.Tokens))
	}
	for _, key := range []string{"secret", "token_hash", "salt"} {
		if _, present := body.Tokens[0][key]; present {
			t.Fatalf("GET /v1/tokens leaked %q", key)
		}
	}
	drainTouch(t, touched)
}

func TestRequestIDIsMintedAndEchoed(t *testing.T) {
	srv, _, _ := newTestServer(t)
	// No inbound X-Request-Id → middleware mints one and echoes it.
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Header().Get(RequestIDHeader) == "" {
		t.Fatalf("response missing %s header", RequestIDHeader)
	}

	// Inbound X-Request-Id → middleware echoes it unchanged.
	const incoming = "test-request-id-deadbeef"
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	r.Header.Set(RequestIDHeader, incoming)
	srv.Handler().ServeHTTP(rr, r)
	if got := rr.Header().Get(RequestIDHeader); got != incoming {
		t.Fatalf("response %s = %q, want %q", RequestIDHeader, got, incoming)
	}
}

func TestAccessLogRedactsAuthorizationHeader(t *testing.T) {
	// docs/architecture/02 §12: access log records only the bearer
	// prefix (first 9 chars), never the full Authorization header.
	var sink bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&sink, nil))

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

	touched := make(chan struct{}, 1)
	srv, err := New(Config{
		DB:     db,
		Logger: logger,
		AuthConfig: auth.Config{
			DB:        db,
			TouchHook: func(string) { touched <- struct{}{} },
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	secret, _ := insertToken(t, db)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	r.Header.Set("Authorization", "Bearer "+secret)
	srv.Handler().ServeHTTP(rr, r)

	// Wait for the async last_used_at goroutine to finish before
	// closing the DB so cleanup doesn't race with an outstanding
	// SQLite write.
	select {
	case <-touched:
	case <-time.After(2 * time.Second):
		t.Fatal("TouchHook never fired within 2s")
	}
	_ = db.Close()

	logLine := sink.String()
	if !strings.Contains(logLine, "bearer_prefix") {
		t.Fatalf("access log missing bearer_prefix field: %s", logLine)
	}
	if strings.Contains(logLine, secret) {
		t.Fatalf("access log leaked full secret: %s", logLine)
	}
	if !strings.Contains(logLine, auth.RedactedPrefix(secret)) {
		t.Fatalf("access log missing redacted prefix %q: %s", auth.RedactedPrefix(secret), logLine)
	}
}

func TestAccessLogRedactsInvalidAuthorizationHeader(t *testing.T) {
	var sink bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&sink, nil))

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

	srv, err := New(Config{DB: db, Logger: logger})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	r.Header.Set("Authorization", "Basic eg-credentials-that-should-never-log")
	srv.Handler().ServeHTTP(rr, r)
	logLine := sink.String()
	if strings.Contains(logLine, "eg-credentials-that-should-never-log") {
		t.Fatalf("access log leaked non-Bearer Authorization payload: %s", logLine)
	}
	if !strings.Contains(logLine, `"bearer_prefix":"<invalid>"`) {
		t.Fatalf("access log missing <invalid> marker: %s", logLine)
	}
}

func TestRecoverConvertsPanicToProblemJSON(t *testing.T) {
	// Mount a panicking handler on top of the canonical chain.
	// We can't easily inject a new route into the built chi router
	// after construction; use the existing /v1/tokens path with a
	// custom server that wraps a panicking handler.
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	mw := recoverMiddleware(logger)
	panicHandler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
	mw(panicHandler).ServeHTTP(rr, r)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("content-type = %q, want %q", ct, problem.ContentType)
	}
	if strings.Contains(rr.Body.String(), "boom") {
		t.Fatalf("response leaked panic text: %s", rr.Body.String())
	}
}

func TestBodyLimitMiddlewareTrips413OnOverlargeBody(t *testing.T) {
	// 02 §12 wants v1 bodies capped at 1 MiB → 413 problem+json.
	srv, db, touched := newTestServer(t)
	secret, _ := insertToken(t, db)

	// 1 MiB + 1 byte of valid JSON-looking padding.
	big := []byte(`{"name":"`)
	big = append(big, bytes.Repeat([]byte("a"), (1<<20)+1)...)
	big = append(big, []byte(`"}`)...)

	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", bytes.NewReader(big))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+secret)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body=%s)", rr.Code, rr.Body.String())
	}
	var body problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Type != string(problem.KindPayloadTooLarge) {
		t.Fatalf("type = %q, want %q", body.Type, problem.KindPayloadTooLarge)
	}
	drainTouch(t, touched)
}

func TestNotFoundReturnsProblemJSON(t *testing.T) {
	srv, _, _ := newTestServer(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/nope", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("content-type = %q, want %q", ct, problem.ContentType)
	}
	// Generic 404 uses the catch-all kind, not the endpoint-specific
	// session_not_found / token_not_found (those belong to the
	// corresponding handlers). docs/architecture/04 §5.1 / §6.5 say
	// the unmounted /bootstrap/mint also lands here.
	var body problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Type != string(problem.KindNotFound) {
		t.Fatalf("type = %q, want %q", body.Type, problem.KindNotFound)
	}
}

func TestUnmountedBootstrapMintRoutesToGenericNotFound(t *testing.T) {
	// 04 §5.1 / §6.5: when mint endpoint is not mounted (every
	// state today, since 3.8 is the commit that mounts it), the
	// router-level NotFound takes over and returns 404 +
	// /problems/not_found — not session/token/anything specific.
	srv, _, _ := newTestServer(t)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/bootstrap/mint", nil)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	var body problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Type != string(problem.KindNotFound) {
		t.Fatalf("unmounted mint type = %q, want %q", body.Type, problem.KindNotFound)
	}
}

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

	"golang.org/x/crypto/argon2"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/server/auth"
	"github.com/nocoo/meowth/daemon/internal/server/mint"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/server/secheaders"
	"github.com/nocoo/meowth/daemon/internal/setupnonce"
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

func TestMountedMintEndpointReceivesPost(t *testing.T) {
	// docs/architecture/04 §6.1: when Config.MintWindow != nil the
	// server.New must mount POST /bootstrap/mint so requests reach
	// the handler (which then enforces loopback / origin / argon2).
	srv, db, _ := newTestServer(t)
	_ = srv
	_ = db
	// Reuse the existing test home to seed a nonce + open a window,
	// then build a new Server with the window attached.
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	setupCode := "mws_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	salt := make([]byte, store.Argon2SaltLen)
	for i := range salt {
		salt[i] = byte(i + 1)
	}
	digest := argon2.IDKey([]byte(setupCode), salt, store.Argon2Time, store.Argon2Memory, store.Argon2Parallelism, store.Argon2KeyLen)
	if err := setupnonce.Write(h.SetupNoncePath, salt, digest); err != nil {
		t.Fatalf("Write: %v", err)
	}
	parsed, err := setupnonce.Parse(h.SetupNoncePath)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	w, err := mint.Open(parsed, h.SetupNoncePath, logger)
	if err != nil {
		t.Fatalf("mint.Open: %v", err)
	}
	srv2, err := New(Config{
		DB:         db,
		Logger:     logger,
		MintWindow: w,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Wrong code → 404 problem+json (counted but we don't assert
	// the count here — covered in handler tests).
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/bootstrap/mint", strings.NewReader(`{"setup_code":"mws_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}`))
	req.RemoteAddr = "127.0.0.1:60000"
	req.Header.Set("Content-Type", "application/json")
	srv2.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if rr.Header().Get("Content-Type") != problem.ContentType {
		t.Fatalf("content-type = %q", rr.Header().Get("Content-Type"))
	}
}

// documentHeaders are the docs/architecture/07 §4.2 HTML-document
// headers that must NEVER appear on API / bootstrap / problem
// responses. Listed by name so the matrix assertions below stay
// readable.
var documentHeaders = []string{
	secheaders.HeaderCSP,
	secheaders.HeaderReferrerPolicy,
	secheaders.HeaderCOOP,
	secheaders.HeaderCORP,
	secheaders.HeaderPermissionsPolicy,
}

func assertNosniff(t *testing.T, hdr http.Header, label string) {
	t.Helper()
	got := hdr.Values(secheaders.HeaderNosniff)
	if len(got) != 1 || got[0] != secheaders.HeaderNosniffValue {
		t.Fatalf("%s: nosniff header = %v, want single %q", label, got, secheaders.HeaderNosniffValue)
	}
}

func assertNoDocumentHeaders(t *testing.T, hdr http.Header, label string) {
	t.Helper()
	for _, name := range documentHeaders {
		if v := hdr.Get(name); v != "" {
			t.Fatalf("%s: API/problem path leaked %s = %q", label, name, v)
		}
	}
}

func TestNosniffOnAllPaths(t *testing.T) {
	// docs/architecture/07 §4.1 C: nosniff is GLOBAL — every
	// response, regardless of status, carries
	// `X-Content-Type-Options: nosniff`. The companion check is
	// that the document-only headers (CSP, COOP, ...) do NOT
	// leak onto API or bootstrap responses.
	srv, db, touched := newTestServer(t)
	secret, _ := insertToken(t, db)

	type tc struct {
		name       string
		method     string
		path       string
		bearer     string
		wantStatus int
	}
	cases := []tc{
		{"healthz 200", http.MethodGet, "/healthz", "", http.StatusOK},
		{"v1 tokens 401", http.MethodGet, "/v1/tokens", "", http.StatusUnauthorized},
		{"v1 tokens 200", http.MethodGet, "/v1/tokens", secret, http.StatusOK},
		{"unmounted bootstrap mint 404", http.MethodPost, "/bootstrap/mint", "", http.StatusNotFound},
		{"unknown route 404", http.MethodGet, "/no-such-route", "", http.StatusNotFound},
	}
	authCount := 0
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			r := httptest.NewRequest(c.method, c.path, nil)
			if c.bearer != "" {
				r.Header.Set("Authorization", "Bearer "+c.bearer)
				authCount++
			}
			srv.Handler().ServeHTTP(rr, r)
			if rr.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, c.wantStatus, rr.Body.String())
			}
			assertNosniff(t, rr.Header(), c.name)
			assertNoDocumentHeaders(t, rr.Header(), c.name)
		})
	}
	// Drain any async last_used_at goroutines started by the
	// bearer middleware so cleanup is race-free.
	for i := 0; i < authCount; i++ {
		drainTouch(t, touched)
	}
}

func TestNosniffOnBodyLimit413(t *testing.T) {
	// Reviewer-cited: prove the chain order — nosniff is BEFORE
	// body_limit, so the 413 also carries the header. This
	// reuses the over-1MiB request the body-limit test uses.
	srv, db, touched := newTestServer(t)
	secret, _ := insertToken(t, db)
	big := []byte(`{"name":"`)
	big = append(big, bytes.Repeat([]byte("a"), (1<<20)+1)...)
	big = append(big, []byte(`"}`)...)

	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", bytes.NewReader(big))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+secret)
	srv.Handler().ServeHTTP(rr, r)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rr.Code)
	}
	assertNosniff(t, rr.Header(), "413")
	assertNoDocumentHeaders(t, rr.Header(), "413")
	drainTouch(t, touched)
}

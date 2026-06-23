package handlers

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
	"github.com/nocoo/meowth/daemon/internal/server/mint"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/setupnonce"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// mintFixture builds a fresh isolated home + DB + opened mint
// window keyed off the supplied setup-code. The returned tearDown
// is a no-op; t.Cleanup hooks close DB and remove the home.
type mintFixture struct {
	Home      *home.Home
	DB        *sql.DB
	Window    *mint.MintWindow
	SetupCode string
	Path      string
}

func newMintFixture(t *testing.T) *mintFixture {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	if err := h.Ensure(); err != nil {
		t.Fatalf("home.Ensure: %v", err)
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

	setupCode := "mws_" + strings.Repeat("A", 39)
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
	return &mintFixture{Home: h, DB: db, Window: w, SetupCode: setupCode, Path: h.SetupNoncePath}
}

// noSleep records the jitter duration but skips actual time.Sleep
// so tests are fast.
type sleepRecorder struct{ d []time.Duration }

func (s *sleepRecorder) record(d time.Duration) { s.d = append(s.d, d) }

func newMintHandler(t *testing.T, f *mintFixture, s *sleepRecorder) *MintHandler {
	t.Helper()
	h := NewMintHandler(f.Window, f.DB, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if s != nil {
		h.Sleep = s.record
	}
	return h
}

func mintReq(t *testing.T, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/bootstrap/mint", bytes.NewBufferString(body))
	r.RemoteAddr = "127.0.0.1:54321"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Host", "127.0.0.1:7040")
	return r
}

func TestMintHappyPath(t *testing.T) {
	f := newMintFixture(t)
	h := newMintHandler(t, f, nil)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": f.SetupCode})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	secret, ok := resp["secret"].(string)
	if !ok || !strings.HasPrefix(secret, "mwt_") || len(secret) != store.SecretTotalLen {
		t.Fatalf("secret malformed: %v", resp["secret"])
	}
	prefix, _ := resp["prefix"].(string)
	if prefix != secret[:store.SecretPrefixLen] {
		t.Fatalf("prefix %q != secret[:9] %q", prefix, secret[:store.SecretPrefixLen])
	}
	if resp["created_via"] != "first_run_mint" {
		t.Fatalf("created_via = %v, want first_run_mint", resp["created_via"])
	}
	if !f.Window.IsClosed() {
		t.Fatal("mint window not closed after success")
	}
	// Subsequent Consume should return Closed.
	rr2 := httptest.NewRecorder()
	h.Mint(rr2, mintReq(t, string(body)))
	if rr2.Code != http.StatusNotFound {
		t.Fatalf("second mint: status = %d, want 404", rr2.Code)
	}
	if bytes.Contains(rr2.Body.Bytes(), []byte("mwt_")) {
		t.Fatal("404 response leaked an mwt_ token")
	}
}

func TestMintNonLoopbackReturnsUncounted404(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": f.SetupCode})
	r := mintReq(t, string(body))
	r.RemoteAddr = "203.0.113.7:12345"
	h.Mint(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if len(sr.d) != 0 {
		t.Fatalf("non-loopback should NOT jitter; got %v", sr.d)
	}
	if f.Window.IsClosed() {
		t.Fatal("non-loopback request closed the window")
	}
}

func TestMintOriginGate(t *testing.T) {
	cases := []struct {
		name       string
		fetchSite  string
		origin     string
		wantStatus int
	}{
		{"cross-site rejected", "cross-site", "", http.StatusNotFound},
		{"same-site rejected", "same-site", "", http.StatusNotFound},
		{"same-origin passes", "same-origin", "", http.StatusCreated},
		{"none passes", "none", "", http.StatusCreated},
		{"no Sec-Fetch-Site passes", "", "", http.StatusCreated},
		{"bad Origin rejected", "", "http://attacker.example", http.StatusNotFound},
		{"matching Origin passes", "", "http://127.0.0.1:7040", http.StatusCreated},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newMintFixture(t)
			sr := &sleepRecorder{}
			h := newMintHandler(t, f, sr)
			rr := httptest.NewRecorder()
			body, _ := json.Marshal(map[string]string{"setup_code": f.SetupCode})
			r := mintReq(t, string(body))
			r.Host = "127.0.0.1:7040"
			if c.fetchSite != "" {
				r.Header.Set("Sec-Fetch-Site", c.fetchSite)
			}
			if c.origin != "" {
				r.Header.Set("Origin", c.origin)
			}
			h.Mint(rr, r)
			if rr.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, c.wantStatus, rr.Body.String())
			}
			// Origin/Sec-Fetch-Site failures must NOT jitter.
			if c.wantStatus == http.StatusNotFound && len(sr.d) != 0 {
				t.Fatalf("uncounted gate jittered: %v", sr.d)
			}
		})
	}
}

func TestMintBodyMalformedCountsAndJitters(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	h.Mint(rr, mintReq(t, `not even json`))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if len(sr.d) != 1 {
		t.Fatalf("counted failure expects exactly 1 sleep call, got %d", len(sr.d))
	}
	if d := sr.d[0]; d < 200*time.Millisecond || d > 500*time.Millisecond {
		t.Fatalf("jitter %v outside [200ms, 500ms]", d)
	}
}

func TestMintFormatErrorCountsAndJitters(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": "garbage"})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	if len(sr.d) != 1 {
		t.Fatalf("expected 1 jitter call, got %d", len(sr.d))
	}
}

func TestMintMismatchCountsAndJitters(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": "mws_" + strings.Repeat("B", 39)})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(sr.d) != 1 {
		t.Fatalf("expected 1 jitter call, got %d", len(sr.d))
	}
}

func TestMintFiveFailuresLockOut(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	wrong, _ := json.Marshal(map[string]string{"setup_code": "mws_" + strings.Repeat("B", 39)})
	for i := 0; i < 5; i++ {
		rr := httptest.NewRecorder()
		h.Mint(rr, mintReq(t, string(wrong)))
		if rr.Code != http.StatusNotFound {
			t.Fatalf("iteration %d status = %d", i, rr.Code)
		}
	}
	if !f.Window.IsClosed() {
		t.Fatal("window not closed after 5 failures")
	}
	// 6th attempt — correct setup-code still 404.
	right, _ := json.Marshal(map[string]string{"setup_code": f.SetupCode})
	rr := httptest.NewRecorder()
	h.Mint(rr, mintReq(t, string(right)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("post-lockout status = %d, want 404", rr.Code)
	}
	if bytes.Contains(rr.Body.Bytes(), []byte("mwt_")) {
		t.Fatal("post-lockout response leaked an mwt_ token")
	}
}

func TestMintResponseShapeMatchesContract(t *testing.T) {
	f := newMintFixture(t)
	h := newMintHandler(t, f, nil)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": f.SetupCode})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rr.Code)
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, k := range []string{"id", "name", "prefix", "secret", "created_at", "created_via"} {
		if _, present := resp[k]; !present {
			t.Fatalf("response missing %q", k)
		}
	}
	if resp["name"] != "bootstrap" {
		t.Fatalf("name = %v, want bootstrap", resp["name"])
	}
}

func TestMintRejectsTrailingJSON(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	h.Mint(rr, mintReq(t, `{"setup_code":"mws_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}{"x":1}`))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	// Trailing JSON counts; verify jitter ran.
	if len(sr.d) != 1 {
		t.Fatalf("expected counted failure jitter, got %d", len(sr.d))
	}
}

func TestMint404ResponseIsProblemJSON(t *testing.T) {
	f := newMintFixture(t)
	sr := &sleepRecorder{}
	h := newMintHandler(t, f, sr)
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": "mws_" + strings.Repeat("B", 39)})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("content-type = %q, want %q", ct, problem.ContentType)
	}
	var p problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Type != string(problem.KindNotFound) {
		t.Fatalf("type = %q, want %q", p.Type, problem.KindNotFound)
	}
}

func TestMintNilWindowReturnsUncounted404(t *testing.T) {
	// Sanity: a handler built with a nil window still 404s (the
	// server won't mount one but defensive paths matter).
	h := &MintHandler{Window: nil, DB: nil, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	rr := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{"setup_code": "mws_" + strings.Repeat("A", 39)})
	h.Mint(rr, mintReq(t, string(body)))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

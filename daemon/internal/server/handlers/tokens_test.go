package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

func newTestDB(t *testing.T) *sql.DB {
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

// chiRouterWithTokens wraps the handler under the same path layout
// the production server uses so tests can exercise URL params.
func chiRouterWithTokens(h *TokensHandler) http.Handler {
	r := chi.NewRouter()
	r.Route("/v1/tokens", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Delete("/{id}", h.Delete)
	})
	return r
}

func TestHealthzShape(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	Healthz(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if got := strings.TrimSpace(rr.Body.String()); got != `{"ok":true}` {
		t.Fatalf("body = %q, want %q", got, `{"ok":true}`)
	}
}

func TestCreateMintsSecretOnce(t *testing.T) {
	db := newTestDB(t)
	h := NewTokensHandler(db)
	body := bytes.NewBufferString(`{"name":"dashboard"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", body)
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithTokens(h).ServeHTTP(rr, r)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	secret, ok := resp["secret"].(string)
	if !ok || !strings.HasPrefix(secret, "mwt_") || len(secret) != store.SecretTotalLen {
		t.Fatalf("secret missing or malformed: %v", resp["secret"])
	}
	if got := resp["created_via"]; got != "dashboard" {
		t.Fatalf("created_via = %v, want 'dashboard' (handler-hardcoded)", got)
	}
	for _, k := range []string{"id", "name", "prefix", "created_at"} {
		if _, present := resp[k]; !present {
			t.Fatalf("response missing %q field", k)
		}
	}
}

func TestCreateRejectsBadName(t *testing.T) {
	db := newTestDB(t)
	h := NewTokensHandler(db)
	for _, body := range []string{
		`{"name":""}`,
		`{"name":"   "}`,
		`{"name":"` + strings.Repeat("a", 65) + `"}`,
	} {
		t.Run(body, func(t *testing.T) {
			rr := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/v1/tokens", bytes.NewBufferString(body))
			r.Header.Set("Content-Type", "application/json")
			chiRouterWithTokens(h).ServeHTTP(rr, r)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestCreateRejectsUnknownFieldOrCreatedViaInjection(t *testing.T) {
	// 03 §4.5 + 02 §9.1: clients cannot dictate created_via. We use
	// DisallowUnknownFields so the request is rejected outright when
	// the caller attempts to inject the column.
	db := newTestDB(t)
	h := NewTokensHandler(db)
	body := bytes.NewBufferString(`{"name":"dashboard","created_via":"init"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", body)
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (created_via injection should fail decode)", rr.Code)
	}
}

func TestListExcludesSecretAndHash(t *testing.T) {
	db := newTestDB(t)
	h := NewTokensHandler(db)
	// Seed two tokens via the public handler so we exercise the full
	// create path (also gives us at least one entry with the right
	// shape for the listing assertions).
	for i := 0; i < 2; i++ {
		body := bytes.NewBufferString(`{"name":"t"}`)
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/v1/tokens", body)
		r.Header.Set("Content-Type", "application/json")
		chiRouterWithTokens(h).ServeHTTP(rr, r)
		if rr.Code != http.StatusCreated {
			t.Fatalf("seed %d: status = %d", i, rr.Code)
		}
	}

	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var resp struct {
		Tokens []map[string]any `json:"tokens"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Tokens) != 2 {
		t.Fatalf("tokens length = %d, want 2", len(resp.Tokens))
	}
	for _, entry := range resp.Tokens {
		for _, k := range []string{"secret", "token_hash", "salt"} {
			if _, present := entry[k]; present {
				t.Fatalf("GET /v1/tokens leaked %q field", k)
			}
		}
		if entry["created_via"] != "dashboard" {
			t.Fatalf("entry created_via = %v, want dashboard", entry["created_via"])
		}
	}
}

func TestDeleteReturns200WithIDAndRevokedAt(t *testing.T) {
	// 02 §9.3: success path returns 200 + {id, revoked_at}.
	db := newTestDB(t)
	h := NewTokensHandler(db)

	// Seed one token and capture its id.
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", bytes.NewBufferString(`{"name":"t"}`))
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	var created map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("seed decode: %v", err)
	}
	id := created["id"].(string)

	// Now DELETE it.
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodDelete, "/v1/tokens/"+id, nil)
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var del map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &del); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if del["id"] != id {
		t.Fatalf("response id = %v, want %v", del["id"], id)
	}
	if _, present := del["revoked_at"]; !present {
		t.Fatalf("response missing revoked_at")
	}

	// Second DELETE → 404 token_not_found.
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodDelete, "/v1/tokens/"+id, nil)
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("second delete: status = %d, want 404", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("404 content-type = %q, want %q", ct, problem.ContentType)
	}
}

func TestDeleteUnknownIDReturns404(t *testing.T) {
	db := newTestDB(t)
	h := NewTokensHandler(db)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodDelete, "/v1/tokens/01900000-0000-7000-8000-000000000000", nil)
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestCreateRejectsTrailingJSON(t *testing.T) {
	// Reviewer-cited: dec.More() is not a top-level trailing-data
	// check. The handler now decodes a second sink and requires
	// io.EOF. Two valid back-to-back objects must trip 400.
	db := newTestDB(t)
	h := NewTokensHandler(db)
	body := bytes.NewBufferString(`{"name":"a"}{"name":"b"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", body)
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for back-to-back JSON objects (body=%s)", rr.Code, rr.Body.String())
	}
	var p problem.Body
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Type != string(problem.KindInvalidRequest) {
		t.Fatalf("type = %q, want %q", p.Type, problem.KindInvalidRequest)
	}
}

func TestCreateAcceptsTrailingWhitespace(t *testing.T) {
	// Reviewer-cited: trailing whitespace must NOT be confused with a
	// second JSON token. `io.EOF` should still be reached after
	// skipping whitespace, so the request succeeds.
	db := newTestDB(t)
	h := NewTokensHandler(db)
	body := bytes.NewBufferString("{\"name\":\"a\"}   \n")
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/tokens", body)
	r.Header.Set("Content-Type", "application/json")
	chiRouterWithTokens(h).ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (trailing whitespace must be tolerated; body=%s)", rr.Code, rr.Body.String())
	}
}

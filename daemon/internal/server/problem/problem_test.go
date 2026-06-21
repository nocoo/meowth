package problem

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteSetsHeadersAndBody(t *testing.T) {
	rr := httptest.NewRecorder()
	if err := Write(rr, http.StatusUnauthorized, KindUnauthorized, "bearer missing", "/v1/tokens"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := rr.Header().Get("Content-Type"); got != ContentType {
		t.Fatalf("Content-Type = %q, want %q", got, ContentType)
	}
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	var body Body
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Type != string(KindUnauthorized) {
		t.Fatalf("type = %q, want %q", body.Type, KindUnauthorized)
	}
	if body.Title != "Unauthorized" {
		t.Fatalf("title = %q, want Unauthorized", body.Title)
	}
	if body.Status != http.StatusUnauthorized {
		t.Fatalf("body.Status = %d, want 401", body.Status)
	}
	if body.Detail != "bearer missing" {
		t.Fatalf("detail = %q, want pass-through", body.Detail)
	}
	if body.Instance != "/v1/tokens" {
		t.Fatalf("instance = %q, want /v1/tokens", body.Instance)
	}
}

func TestWriteInternalReplacesDetail(t *testing.T) {
	// docs/architecture/02 §10.2: internal never leaks server-side
	// error text to the client. Write must override any detail the
	// caller passed.
	rr := httptest.NewRecorder()
	if err := Write(rr, http.StatusInternalServerError, KindInternal,
		"panic: sql: no rows in result set [secret hash 0xdead...]",
		"/v1/sessions/abc",
	); err != nil {
		t.Fatalf("Write: %v", err)
	}
	var body Body
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Detail != internalDetailFallback {
		t.Fatalf("internal detail = %q, want %q", body.Detail, internalDetailFallback)
	}
	if strings.Contains(body.Detail, "secret hash") || strings.Contains(body.Detail, "sql:") {
		t.Fatalf("internal detail leaked caller text: %q", body.Detail)
	}
}

func TestKindConstantsMatchDocsSlugs(t *testing.T) {
	// Lock the exact slugs docs/architecture/02 §10.2 promises so a
	// renamed constant immediately fails this test.
	want := map[Kind]string{
		KindInvalidRequest:     "/problems/invalid_request",
		KindUnauthorized:       "/problems/unauthorized",
		KindNotFound:           "/problems/not_found",
		KindUnknownBackend:     "/problems/unknown_backend",
		KindSessionNotFound:    "/problems/session_not_found",
		KindTokenNotFound:      "/problems/token_not_found",
		KindSessionConflict:    "/problems/session_conflict",
		KindPayloadTooLarge:    "/problems/payload_too_large",
		KindBackendUnavailable: "/problems/backend_unavailable",
		KindInternal:           "/problems/internal",
	}
	for k, v := range want {
		if string(k) != v {
			t.Fatalf("constant for %q = %q, want %q", v, string(k), v)
		}
		if !SlugIsValid(k) {
			t.Fatalf("%q failed SlugIsValid", k)
		}
		if _, ok := Title(k); !ok {
			t.Fatalf("missing title for %q", k)
		}
	}
	if len(AllKinds()) != len(want) {
		t.Fatalf("AllKinds() length = %d, want %d", len(AllKinds()), len(want))
	}
}

func TestWriteRejectsEmptyKind(t *testing.T) {
	rr := httptest.NewRecorder()
	if err := Write(rr, http.StatusBadRequest, Kind(""), "anything", "/v1/x"); err == nil {
		t.Fatal("Write accepted empty kind")
	}
}

func TestWriteRejectsUnknownKind(t *testing.T) {
	rr := httptest.NewRecorder()
	if err := Write(rr, http.StatusTeapot, Kind("/problems/not_registered"), "anything", "/v1/x"); err == nil {
		t.Fatal("Write accepted unregistered kind")
	}
}

func TestWriteRejectsNilWriter(t *testing.T) {
	if err := Write(nil, 500, KindInternal, "", "/x"); err == nil {
		t.Fatal("Write accepted nil ResponseWriter")
	}
}

func TestSlugIsValidRejectsMalformed(t *testing.T) {
	for _, bad := range []Kind{
		Kind(""),
		Kind("invalid_request"),      // missing prefix
		Kind("/problems/"),           // empty tail
		Kind("/problems/Has-Hyphen"), // hyphen forbidden
		Kind("/problems/UPPERCASE"),
		Kind("/problems/with space"),
	} {
		if SlugIsValid(bad) {
			t.Fatalf("SlugIsValid(%q) = true, want false", bad)
		}
	}
}

// Belt + braces: pin internal helper signature against accidental
// drift (used by auth.Middleware in this commit).
var _ = errors.New

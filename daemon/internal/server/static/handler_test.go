package static

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestIsHTMLFallback_AllowsRootAndIndex(t *testing.T) {
	cases := []string{"/", "/index.html"}
	for _, c := range cases {
		if !IsHTMLFallback(http.MethodGet, c) {
			t.Errorf("IsHTMLFallback(GET, %q) = false, want true", c)
		}
	}
}

func TestIsHTMLFallback_AllowsExtensionlessDeepLinks(t *testing.T) {
	cases := []string{
		"/overview",
		"/agents",
		"/tokens",
		"/settings",
		"/setup",
		"/sessions",
		"/sessions/019ee83f-661f-715f-b186-2db67a23b559",
	}
	for _, c := range cases {
		if !IsHTMLFallback(http.MethodGet, c) {
			t.Errorf("IsHTMLFallback(GET, %q) = false, want true", c)
		}
	}
}

func TestIsHTMLFallback_RejectsReservedPrefixes(t *testing.T) {
	cases := []string{
		"/v1",
		"/v1/agents",
		"/v1/foo/bar",
		"/bootstrap",
		"/bootstrap/mint",
		"/healthz",
		"/problems",
		"/problems/not_found",
		"/assets",
		"/assets/index-abc.js",
	}
	for _, c := range cases {
		if IsHTMLFallback(http.MethodGet, c) {
			t.Errorf("IsHTMLFallback(GET, %q) = true, want false", c)
		}
	}
}

func TestIsHTMLFallback_RejectsFileExtensions(t *testing.T) {
	cases := []string{"/favicon.ico", "/unknown.txt", "/robots.txt", "/x.js"}
	for _, c := range cases {
		if IsHTMLFallback(http.MethodGet, c) {
			t.Errorf("IsHTMLFallback(GET, %q) = true, want false", c)
		}
	}
}

func TestIsHTMLFallback_RejectsNonGet(t *testing.T) {
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/"},
		{http.MethodPut, "/overview"},
		{http.MethodDelete, "/setup"},
		{http.MethodPatch, "/sessions/abc"},
	}
	for _, c := range cases {
		if IsHTMLFallback(c.method, c.path) {
			t.Errorf("IsHTMLFallback(%s, %q) = true, want false", c.method, c.path)
		}
	}
}

func newTestFS() fs.FS {
	return fstest.MapFS{
		"index.html":         &fstest.MapFile{Data: []byte("<!doctype html><html><body>app</body></html>")},
		"assets/index-X.js":  &fstest.MapFile{Data: []byte("export const x = 1;")},
		"assets/index-Y.css": &fstest.MapFile{Data: []byte(":root{}")},
	}
}

func notFoundInner() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"type":"/problems/not_found","title":"Not Found","status":404}`))
	})
}

func TestServeRoot_ReturnsIndexHTMLWithDocumentHeaders(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("Content-Type = %q, want text/html prefix", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	if got := rec.Header().Get("Content-Security-Policy"); got == "" {
		t.Error("Content-Security-Policy header missing on HTML response")
	}
	if !strings.Contains(rec.Body.String(), "app") {
		t.Errorf("body did not contain expected dashboard markup")
	}
}

func TestServeDeepLink_ReturnsIndexHTML(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodGet, "/overview", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "app") {
		t.Errorf("expected SPA index.html body")
	}
}

func TestServeAsset_ReturnsBytesAndImmutableCache(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodGet, "/assets/index-X.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, want javascript", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q, want immutable", cc)
	}
	if rec.Header().Get("Content-Security-Policy") != "" {
		t.Error("asset response must not carry document-level CSP")
	}
}

func TestServeAsset_MissingReturns404WithoutFallback(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("asset miss must not fall back to index.html")
	}
}

func TestReservedPath_DelegatesToInnerHandler(t *testing.T) {
	innerCalled := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		innerCalled = true
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"/problems/unauthorized","title":"Unauthorized","status":401}`))
	})
	h := New(newTestFS(), inner)
	for _, path := range []string{"/v1/agents", "/bootstrap/mint", "/healthz", "/problems/x"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		h.ServeHTTP(rec, req)
		if !innerCalled {
			t.Errorf("inner not called for %q", path)
		}
		if got := rec.Header().Get("Content-Security-Policy"); got != "" {
			t.Errorf("%q: CSP header leaked to API response", path)
		}
		innerCalled = false
	}
}

func TestPostRoot_DoesNotReturnIndexHTML(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	// chi/static wrapper routes non-GET / through the inner mux,
	// which returns the problem+json 404. Either 404 (current
	// inner) or 405 (if upstream router prefers method-not-allowed)
	// is acceptable; the invariant is that no index.html body
	// and no document headers leak.
	if rec.Code == http.StatusOK {
		t.Fatalf("POST / returned 200, body=%q", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("POST / leaked index.html body")
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != "" {
		t.Errorf("POST / leaked CSP header")
	}
}

func TestExtensionPath_DoesNotFallBack(t *testing.T) {
	h := New(newTestFS(), notFoundInner())
	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("missing /favicon.ico leaked index.html")
	}
}

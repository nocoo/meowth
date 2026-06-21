package secheaders

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// echoHandler writes a status + tiny body so the wrapper tests can
// confirm next-handler state is preserved.
func echoHandler(status int, body string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	})
}

func TestNosniffSetsHeader(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/anything", nil)
	Nosniff()(echoHandler(200, "ok")).ServeHTTP(rr, r)
	if got := rr.Header().Get(HeaderNosniff); got != HeaderNosniffValue {
		t.Fatalf("nosniff header = %q, want %q", got, HeaderNosniffValue)
	}
	if rr.Code != 200 || rr.Body.String() != "ok" {
		t.Fatalf("wrapper altered next: code=%d body=%q", rr.Code, rr.Body.String())
	}
}

func TestNosniffUsesSetNotAdd(t *testing.T) {
	// If a downstream handler also writes the header, Set ensures
	// the final value is single-valued, not duplicated.
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(HeaderNosniff, HeaderNosniffValue) // duplicate write
		w.WriteHeader(200)
	})
	Nosniff()(inner).ServeHTTP(rr, r)
	vals := rr.Header().Values(HeaderNosniff)
	if len(vals) != 1 {
		t.Fatalf("expected single value, got %v", vals)
	}
}

func TestDocumentSetsAllHTMLHeaders(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	Document(echoHandler(200, "<!doctype html>")).ServeHTTP(rr, r)
	want := map[string]string{
		HeaderNosniff:           HeaderNosniffValue,
		HeaderCSP:               CSPHTMLDocument,
		HeaderReferrerPolicy:    HeaderReferrerPolicyValue,
		HeaderCOOP:              HeaderCOOPValue,
		HeaderCORP:              HeaderCORPValue,
		HeaderPermissionsPolicy: PermissionsPolicyHTMLDocument,
		HeaderCacheControl:      HeaderCacheControlNoCache,
	}
	for k, v := range want {
		if got := rr.Header().Get(k); got != v {
			t.Fatalf("%s = %q, want %q", k, got, v)
		}
	}
	if rr.Body.String() != "<!doctype html>" {
		t.Fatalf("body altered: %q", rr.Body.String())
	}
}

func TestDocumentDoesNotSetContentType(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	// Inner handler intentionally does NOT set Content-Type; the
	// wrapper must not silently fill one in (the HTML handler is
	// the owner of that header).
	Document(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})).ServeHTTP(rr, r)
	if got := rr.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Document unexpectedly set Content-Type %q", got)
	}
}

func TestAssetImmutableHeaders(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/assets/app.abc123.js", nil)
	Asset("application/javascript; charset=utf-8", true)(echoHandler(200, "console.log(1)")).ServeHTTP(rr, r)
	want := map[string]string{
		HeaderNosniff:      HeaderNosniffValue,
		HeaderCORP:         HeaderCORPValue,
		HeaderCacheControl: HeaderCacheControlImmutable,
		"Content-Type":     "application/javascript; charset=utf-8",
	}
	for k, v := range want {
		if got := rr.Header().Get(k); got != v {
			t.Fatalf("%s = %q, want %q", k, got, v)
		}
	}
	// Asset must NOT inject document-level headers.
	for _, k := range []string{HeaderCSP, HeaderReferrerPolicy, HeaderCOOP, HeaderPermissionsPolicy} {
		if got := rr.Header().Get(k); got != "" {
			t.Fatalf("Asset leaked document header %s = %q", k, got)
		}
	}
}

func TestAssetNonImmutableUsesNoCache(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/assets/app.html", nil)
	Asset("text/html; charset=utf-8", false)(echoHandler(200, "<html></html>")).ServeHTTP(rr, r)
	if got := rr.Header().Get(HeaderCacheControl); got != HeaderCacheControlNoCache {
		t.Fatalf("non-immutable Cache-Control = %q, want %q", got, HeaderCacheControlNoCache)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
}

func TestAssetWithoutContentTypeDoesNotForceOne(t *testing.T) {
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/assets/whatever", nil)
	// Inner does not set Content-Type; wrapper called with empty
	// contentType should not invent one.
	Asset("", true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})).ServeHTTP(rr, r)
	if got := rr.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Asset(\"\", true) injected Content-Type %q", got)
	}
}

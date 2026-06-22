// Package static serves the embedded dashboard. It dispatches between:
//
//   - GET /assets/* — file from the embed FS with secheaders.Asset
//     (immutable Cache-Control) and a Content-Type from the file ext
//   - GET / and GET /<dashboard-deep-link> — index.html with
//     secheaders.Document and Cache-Control: no-cache
//   - everything else — falls through to the inner mux (API,
//     /healthz, /bootstrap, /problems, anything with a file ext,
//     non-GET methods)
//
// docs/architecture/06 §10.1 deep links (/overview, /sessions/:id,
// /setup, /agents, /tokens, /settings) must render the SPA; reserved
// API namespaces and asset-shaped misses must NOT fall back to HTML.

package static

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/nocoo/meowth/daemon/internal/server/secheaders"
)

// reservedPrefixes are paths that must never be served the SPA HTML
// fallback. They keep their existing API / problem / health / bootstrap
// semantics. /assets is reserved because asset misses should 404, not
// fall back to index.html.
var reservedPrefixes = []string{
	"/v1",
	"/bootstrap",
	"/healthz",
	"/problems",
	"/assets",
}

// IsHTMLFallback returns true when the request should be served the
// dashboard's index.html for SPA routing. Pure function; the test
// suite exercises every branch.
func IsHTMLFallback(method, urlPath string) bool {
	if method != http.MethodGet {
		return false
	}
	if urlPath == "/" || urlPath == "/index.html" {
		return true
	}
	if !strings.HasPrefix(urlPath, "/") {
		return false
	}
	for _, p := range reservedPrefixes {
		if urlPath == p || strings.HasPrefix(urlPath, p+"/") {
			return false
		}
	}
	// Anything with a file extension in the final segment is a
	// resource request; do not serve HTML for /favicon.ico,
	// /foo.js, /image.png, etc.
	last := path.Base(urlPath)
	return !strings.Contains(last, ".")
}

// New returns an http.Handler that serves the embedded dashboard
// and delegates everything else to inner. The dist FS must contain
// at least index.html when serving production traffic; with only
// the .gitkeep guard, GET / and /assets/* will 404 (caller decides
// to fail fast in CI via the prepare script).
func New(dist fs.FS, inner http.Handler) http.Handler {
	assetWrap := func(h http.Handler, contentType string) http.Handler {
		return secheaders.Asset(contentType, true)(h)
	}
	documentWrap := secheaders.Document
	indexFile, indexErr := fs.ReadFile(dist, "index.html")

	serveAsset := func(w http.ResponseWriter, r *http.Request) {
		// Trim the leading slash for fs.FS.
		name := strings.TrimPrefix(r.URL.Path, "/")
		data, err := fs.ReadFile(dist, name)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				http.NotFound(w, r)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		ct := contentTypeFor(name)
		w.Header().Set("Content-Type", ct)
		assetWrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			// Asset bytes come from the embedded dist FS — daemon's
			// own build output, not user input — and the only path
			// component is r.URL.Path inside the /assets/ namespace.
			// G705 (taint) is a false positive here: data is bytes
			// from go:embed, content-type is derived from the embed
			// filename, no header reflection.
			//#nosec G705
			_, _ = w.Write(data)
		}), ct).ServeHTTP(w, r)
	}

	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		if indexErr != nil {
			http.NotFound(w, r)
			return
		}
		documentWrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			_, _ = w.Write(indexFile)
		})).ServeHTTP(w, r)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reserved namespaces and non-GET always delegate.
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/assets/") {
			serveAsset(w, r)
			return
		}
		if IsHTMLFallback(r.Method, r.URL.Path) {
			serveIndex(w, r)
			return
		}
		inner.ServeHTTP(w, r)
	})
}

func contentTypeFor(name string) string {
	ext := path.Ext(name)
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

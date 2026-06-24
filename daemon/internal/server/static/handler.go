// Package static serves the embedded dashboard. It exposes three
// discrete http.Handler factories so the caller (server.New) can
// mount them inside the chi router and reuse the existing fixed
// middleware chain (request_id → access_log → recover → nosniff →
// body_limit → bearer):
//
//   - Index(dist) — writes dist/index.html with secheaders.Document
//     and Cache-Control: no-cache. Mount as GET /.
//   - Asset(dist) — serves dist/<path> with secheaders.Asset(...).
//     Mount as GET /assets/*; chi strips the prefix via chi.URLParam.
//   - NotFoundFallback(dist, fallback) — decides whether the
//     request is an extensionless SPA deep link and serves
//     index.html; otherwise calls fallback (typically the
//     problem+json 404 handler). Mount on chi.Router.NotFound.
//
// Going through the chi router guarantees every static success or
// error response carries the chain's invariants — most importantly
// the global X-Content-Type-Options: nosniff middleware.

package static

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/server/secheaders"
)

// reservedPrefixes are paths that must never be served the SPA HTML
// fallback. They keep their existing API / problem / health /
// bootstrap semantics. /assets is reserved because asset misses
// should 404, not fall back to index.html.
var reservedPrefixes = []string{
	"/v1",
	"/bootstrap",
	"/healthz",
	"/problems",
	"/assets",
}

// IsHTMLFallback returns true when a 404'd request should be served
// the dashboard's index.html for SPA routing. Pure function; the
// test suite exercises every branch.
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

// Index returns a handler that writes dist/index.html with the
// document-level security headers. Mount as GET / (and reuse for
// GET /index.html via NotFoundFallback).
func Index(dist fs.FS) http.Handler {
	body, err := fs.ReadFile(dist, "index.html")
	return secheaders.Document(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	}))
}

// Asset returns a handler that serves dist/<path-after-prefix>. The
// chi route must be GET /assets/* so the wildcard segment is
// available via chi.URLParam(r, "*"). Missing files return 404 with
// no Document headers but still flow through whatever middleware
// chain the caller has mounted (e.g. global Nosniff).
func Asset(dist fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sub := chi.URLParam(r, "*")
		name := path.Join("assets", sub)
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
		secheaders.Asset(ct, true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			// Asset bytes are go:embed'd output of the daemon's own
			// dashboard build, not user input. Content-Type is
			// derived from the embed file name. G705 (taint) is a
			// false positive on this controlled flow.
			//#nosec G705
			_, _ = w.Write(data)
		})).ServeHTTP(w, r)
	})
}

// NotFoundFallback returns a handler suitable for chi.Router.NotFound.
// Extensionless dashboard deep links (e.g. /overview, /sessions/abc)
// serve dist/index.html through Index; everything else (missing
// asset, unknown extension, non-GET, reserved prefix) delegates to
// fallback so the original problem+json 404 still wins.
func NotFoundFallback(dist fs.FS, fallback http.Handler) http.Handler {
	index := Index(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if IsHTMLFallback(r.Method, r.URL.Path) {
			index.ServeHTTP(w, r)
			return
		}
		fallback.ServeHTTP(w, r)
	})
}

// RootAsset returns a handler that serves a single named file from
// the embedded dist FS root (e.g. /favicon.ico → dist/favicon.ico).
// Used for brand assets that the dashboard's index.html references
// at the site root (favicon, apple-touch-icon, logo PNGs, og-image)
// — these live in apps/dashboard/public/ during dev and are
// duplicated to apps/dashboard/dist/ by Vite at build time, then
// folded into the daemon binary via go:embed.
//
// Each chi route should be GET /<filename> wired to this handler;
// the filename argument is trusted (constructed by server.go from
// the literal list, not user input).
func RootAsset(dist fs.FS, name string) http.Handler {
	data, readErr := fs.ReadFile(dist, name)
	ct := contentTypeFor(name)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if readErr != nil {
			if errors.Is(readErr, fs.ErrNotExist) {
				http.NotFound(w, r)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", ct)
		secheaders.Asset(ct, true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			//#nosec G705 -- name is a hard-coded brand asset filename
			_, _ = w.Write(data)
		})).ServeHTTP(w, r)
	})
}

func contentTypeFor(name string) string {
	ext := path.Ext(name)
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

// Package secheaders implements the docs/architecture/07 §4
// security-header surface for the daemon. It exposes three units:
//
//   - Nosniff: a global chi middleware that writes
//     `X-Content-Type-Options: nosniff` on every response. Mounted
//     by server.New between recover and body_limit.
//   - Document: an http.Handler wrapper that adds the full §4.2
//     HTML-document header set (CSP, Referrer-Policy, COOP, CORP,
//     Permissions-Policy, Cache-Control: no-cache). It is NOT
//     mounted by server.New — the future dashboard embed handler
//     wraps its own HTML route with this.
//   - Asset(contentType, immutable): an http.Handler wrapper for
//     static assets. Sets Content-Type, CORP, and an explicit
//     Cache-Control (immutable=true → public, max-age=31536000,
//     immutable; immutable=false → no-cache). Like Document, it is
//     not wired into the router by server.New.
//
// The split is intentional: docs/architecture/07 §4.1 forbids
// injecting CSP / COOP / CORP / Referrer-Policy / Permissions-Policy
// onto API or bootstrap responses. Only the future dashboard
// HTML/static handler may use Document / Asset.
package secheaders

import "net/http"

// CSPHTMLDocument is the docs/architecture/07 §4.2 Content-Security-
// Policy header value as a single literal. The directive ORDER itself
// is part of the reviewable contract — do not regenerate this from a
// map or slice.
const CSPHTMLDocument = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

// PermissionsPolicyHTMLDocument is the docs/architecture/07 §4.2
// Permissions-Policy value. Same contract: ordering is reviewed.
const PermissionsPolicyHTMLDocument = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"

// Document-level header names and values. Exported as constants so
// L1 tests assert against the exact same strings the middleware
// writes.
const (
	HeaderNosniff               = "X-Content-Type-Options"
	HeaderNosniffValue          = "nosniff"
	HeaderCSP                   = "Content-Security-Policy"
	HeaderReferrerPolicy        = "Referrer-Policy"
	HeaderReferrerPolicyValue   = "no-referrer"
	HeaderCOOP                  = "Cross-Origin-Opener-Policy"
	HeaderCOOPValue             = "same-origin"
	HeaderCORP                  = "Cross-Origin-Resource-Policy"
	HeaderCORPValue             = "same-origin"
	HeaderPermissionsPolicy     = "Permissions-Policy"
	HeaderCacheControl          = "Cache-Control"
	HeaderCacheControlNoCache   = "no-cache"
	HeaderCacheControlImmutable = "public, max-age=31536000, immutable"
)

// Nosniff returns the chi-compatible middleware that writes
// `X-Content-Type-Options: nosniff` to every response. Uses Set so
// duplicate values cannot accumulate even if a handler / inner
// middleware adds its own copy.
func Nosniff() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set(HeaderNosniff, HeaderNosniffValue)
			next.ServeHTTP(w, r)
		})
	}
}

// Document wraps next with the docs/architecture/07 §4.2 HTML-
// document header set. The wrapper does NOT set Content-Type — the
// HTML handler is responsible for that — to avoid surprising
// callers that already wrote `text/html; charset=utf-8` (or some
// future variant). The wrapper sets headers BEFORE calling next so
// they survive even if next writes a response body without
// touching headers explicitly.
func Document(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set(HeaderNosniff, HeaderNosniffValue)
		h.Set(HeaderCSP, CSPHTMLDocument)
		h.Set(HeaderReferrerPolicy, HeaderReferrerPolicyValue)
		h.Set(HeaderCOOP, HeaderCOOPValue)
		h.Set(HeaderCORP, HeaderCORPValue)
		h.Set(HeaderPermissionsPolicy, PermissionsPolicyHTMLDocument)
		h.Set(HeaderCacheControl, HeaderCacheControlNoCache)
		next.ServeHTTP(w, r)
	})
}

// Asset returns an http.Handler wrapper that injects the docs/
// architecture/07 §4.3 static-asset header set. The caller passes
// the asset's Content-Type and chooses cache semantics via the
// immutable flag (true for Vite hash-named JS/CSS/fonts, false for
// content that needs no-cache).
//
// Like Document, the wrapper is not auto-mounted by server.New.
func Asset(contentType string, immutable bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		cacheVal := HeaderCacheControlNoCache
		if immutable {
			cacheVal = HeaderCacheControlImmutable
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set(HeaderNosniff, HeaderNosniffValue)
			h.Set(HeaderCORP, HeaderCORPValue)
			h.Set(HeaderCacheControl, cacheVal)
			if contentType != "" {
				h.Set("Content-Type", contentType)
			}
			next.ServeHTTP(w, r)
		})
	}
}

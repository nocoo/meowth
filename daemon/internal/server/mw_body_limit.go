package server

import (
	"net/http"
)

// bodyLimitMiddleware wraps r.Body in an http.MaxBytesReader so any
// handler that tries to read more than `limit` bytes triggers a
// MaxBytesError. The middleware itself does NOT pre-read; it only
// installs the cap. Handlers detect the resulting *http.MaxBytesError
// (via errors.As) and translate to a 413 problem+json on their own
// — keeping the translation next to the JSON decode site where the
// error actually surfaces, rather than at chain layer where we would
// need to inspect responses ad-hoc.
func bodyLimitMiddleware(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

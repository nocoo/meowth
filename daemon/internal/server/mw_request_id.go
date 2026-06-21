package server

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// requestIDKey is the context key under which the resolved request id
// is stored. Exported through RequestIDFromContext.
type requestIDKeyT struct{}

var requestIDKey requestIDKeyT

// RequestIDHeader is the canonical HTTP header per docs/architecture/02 §12.
const RequestIDHeader = "X-Request-Id"

// RequestIDFromContext returns the X-Request-Id pinned by
// requestIDMiddleware. Returns "" when called outside the middleware
// chain.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(requestIDKey).(string)
	return v
}

// requestIDMiddleware reads X-Request-Id from the inbound request or
// mints a fresh uuid v7 when absent, then propagates the value via
// both context and the response header. Sits outermost so every log
// line and error response below it carries the same id.
func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if id == "" {
			u, err := uuid.NewV7()
			if err == nil {
				id = u.String()
			}
		}
		if id != "" {
			w.Header().Set(RequestIDHeader, id)
			r = r.WithContext(context.WithValue(r.Context(), requestIDKey, id))
		}
		next.ServeHTTP(w, r)
	})
}

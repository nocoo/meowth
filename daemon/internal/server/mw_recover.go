package server

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/nocoo/meowth/daemon/internal/server/problem"
)

// recoverMiddleware catches panics from downstream handlers and
// surfaces them as problem+json 500. The original panic value plus
// stack lands in the daemon log via the supplied slogger; the
// response body is the canonical "internal server error" — never the
// panic text — per docs/architecture/02 §10.
func recoverMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.LogAttrs(r.Context(), slog.LevelError, "http_panic",
						slog.Any("panic", rec),
						slog.String("path", r.URL.Path),
						slog.String("request_id", RequestIDFromContext(r.Context())),
						slog.String("stack", string(debug.Stack())),
					)
					_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

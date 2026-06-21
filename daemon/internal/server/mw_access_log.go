package server

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nocoo/meowth/daemon/internal/server/auth"
)

// accessLogMiddleware emits one slog line per request after the
// downstream handler runs. It records method, path, status,
// duration_ms, request_id, and the bearer's redacted 9-char prefix
// (per docs/architecture/02 §12). It never logs the full Authorization
// header or anything beyond auth.RedactedPrefix's output, even when
// the request was rejected.
func accessLogMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			logger.LogAttrs(r.Context(), slog.LevelInfo, "http_access",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rec.status),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
				slog.String("request_id", RequestIDFromContext(r.Context())),
				slog.String("bearer_prefix", redactedAuthorization(r.Header.Get("Authorization"))),
			)
		})
	}
}

// statusRecorder is a thin http.ResponseWriter that remembers the
// status code so accessLog can read it after ServeHTTP returns.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.status = http.StatusOK
		s.wroteHeader = true
	}
	return s.ResponseWriter.Write(b)
}

// redactedAuthorization parses an Authorization header strictly:
// only the bytes after "Bearer " (exactly one space) are passed to
// auth.RedactedPrefix. Anything else — Basic, empty, malformed — is
// reported as "<invalid>", never the original header text.
func redactedAuthorization(header string) string {
	const scheme = "Bearer "
	if !strings.HasPrefix(header, scheme) {
		if header == "" {
			return ""
		}
		return "<invalid>"
	}
	return auth.RedactedPrefix(header[len(scheme):])
}

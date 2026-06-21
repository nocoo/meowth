// Package auth implements the bearer-token middleware from
// docs/architecture/02-daemon-http-protocol.md §12 and the
// authenticate() algorithm from
// docs/architecture/03-sqlite-schema-and-tokens.md §5.2.
//
// Public surface is intentionally minimal:
//   - Middleware(cfg) → (func(http.Handler) http.Handler, error)
//   - TokenIDFromContext(ctx) → (string, bool)  for downstream handlers
//   - RedactedPrefix(secret) → first 9 chars suitable for access_log
//
// Router wiring, request_id / access_log / recover middleware live
// in Phase 3.7. Bearer auth ships first because every v1 endpoint
// depends on it.
package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Hasher mirrors argon2.IDKey's call signature so tests can inject a
// counted/stub hasher and reason structurally about how many times
// the middleware called it.
type Hasher func(presented, salt []byte) []byte

// Config carries the dependencies Middleware needs. Production wiring
// (Phase 3.7) will fill DB; tests fill the hooks too.
type Config struct {
	DB     *sql.DB
	Hasher Hasher

	// Clock supplies the timestamp written to tokens.last_used_at on
	// a successful auth. Defaults to time.Now.UTC().
	Clock func() time.Time

	// TouchHook is a test-only observer: if non-nil it is called from
	// inside the async last_used_at goroutine with the token id. The
	// production wiring leaves this nil.
	TouchHook func(id string)
}

type ctxKey struct{}

var tokenIDKey ctxKey

// TokenIDFromContext returns the token id placed in the request
// context by a successful Middleware run. Returns false when called
// from a handler that was reached without bearer auth (e.g. /healthz).
func TokenIDFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	v, ok := ctx.Value(tokenIDKey).(string)
	return v, ok
}

// RedactedPrefix returns the first 9 characters of a bearer token,
// safe for log emission per docs/architecture/02 §12 and §10.3.
// Returns "<invalid>" when the input does not look like a meowth
// token at all so callers cannot accidentally surface noise.
func RedactedPrefix(presented string) string {
	if len(presented) < store.SecretPrefixLen || !strings.HasPrefix(presented, "mwt_") {
		return "<invalid>"
	}
	return presented[:store.SecretPrefixLen]
}

// Middleware builds the bearer auth http.Handler middleware. It does
// not register any routes — that is the router's job (Phase 3.7).
//
// The returned middleware:
//   - Lets requests without an `Authorization` header reach 401
//     unconditionally; it never strips other headers.
//   - Does not query the DB or run the hasher when the token is
//     mal-formed (wrong scheme / length / prefix). Format errors are
//     surfaced as 401 problem+json type=unauthorized without leaking
//     the reason (docs/architecture/02 §10.3).
//   - Walks every active row matching the prefix (no short-circuit
//     on first match) so a multi-row prefix collision does not leak
//     "which row matched" via timing.
//   - When no row matched, runs one extra argon2id pass against
//     dummy salt/hash to keep the wall-clock cost comparable to a
//     real verify (the dummy oracle from 03 §5.2).
//   - Touches tokens.last_used_at in a detached goroutine; the
//     5-second timeout from 03 §5.2 is enforced via context.
//   - On success places the token id into the request context via
//     TokenIDFromContext.
func Middleware(cfg Config) (func(http.Handler) http.Handler, error) {
	if cfg.DB == nil {
		return nil, errors.New("auth: nil DB")
	}
	if cfg.Hasher == nil {
		cfg.Hasher = store.Argon2IDKey
	}
	if cfg.Clock == nil {
		cfg.Clock = func() time.Time { return time.Now().UTC() }
	}
	ensureDummy()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 02 §12 protects only /v1/* (and the implicit /v1 root,
			// though the router currently lists no bare /v1 endpoint).
			// /healthz, /, /bootstrap/*, /problems/*, the dashboard
			// static tree, and OPTIONS preflight requests are
			// pass-through. The check happens before any DB / hasher
			// work so non-v1 routes incur zero crypto cost.
			if !requiresBearer(r) {
				next.ServeHTTP(w, r)
				return
			}

			presented, ok := extractBearer(r.Header.Get("Authorization"))
			if !ok || !looksLikeMeowthToken(presented) {
				writeUnauthorized(w, r)
				return
			}

			ctx := r.Context()
			rows, err := store.ListActiveTokensByPrefix(ctx, cfg.DB, presented[:store.SecretPrefixLen])
			if err != nil {
				_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
				return
			}

			// Per 03 §10.1, copy the secret into a private []byte that
			// we can zero after the digest is computed; the Go string
			// is immutable.
			presentedBytes := []byte(presented)
			defer zero(presentedBytes)

			var (
				matched bool
				winner  store.Token
			)
			for _, row := range rows {
				computed := cfg.Hasher(presentedBytes, row.Salt)
				if subtle.ConstantTimeCompare(computed, row.TokenHash) == 1 && !matched {
					matched = true
					winner = row
				}
				// Note: no break. We continue to keep timing equal across
				// collision sizes; 03 §5.2.
			}

			if !matched {
				// 0 matched rows. Run one dummy pass so 0-hit and 1-hit
				// paths cost a similar amount of wall-clock. If `rows`
				// was non-empty (every row hash-mismatched) we already
				// ran len(rows) real verifications, so an extra dummy
				// here would over-pay; skip in that case.
				if len(rows) == 0 {
					_ = cfg.Hasher(presentedBytes, dummySalt)
					_ = subtle.ConstantTimeCompare(dummyHash, dummyHash)
				}
				writeUnauthorized(w, r)
				return
			}

			// Async update of last_used_at, capped at 5s per 03 §5.2.
			// The goroutine intentionally uses context.Background rather
			// than the request context so the UPDATE survives the
			// client's response completing or the connection closing —
			// that is the whole point of the async path.
			go func(id string, when time.Time) { //nolint:gosec // G118 false positive: async update outlives the request by design (03 §5.2)
				touchCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				// Best-effort: errors here only become a log line in 3.7.
				_ = store.TouchTokenLastUsedAt(touchCtx, cfg.DB, id, when)
				if cfg.TouchHook != nil {
					cfg.TouchHook(id)
				}
			}(winner.ID, cfg.Clock())

			next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, tokenIDKey, winner.ID)))
		})
	}, nil
}

func extractBearer(header string) (string, bool) {
	const scheme = "Bearer "
	if !strings.HasPrefix(header, scheme) {
		return "", false
	}
	// Per docs/architecture/03 §5.1, the wire contract is exactly
	// `Bearer <43-char mwt_ token>`; the bytes after "Bearer " are the
	// presented token verbatim. We do NOT TrimSpace here so trailing
	// whitespace, tabs, or stray bytes naturally fail the length/prefix
	// check below — that keeps the format contract strict and avoids
	// turning the header into a "tolerant" parser.
	return header[len(scheme):], true
}

// requiresBearer encodes docs/architecture/02 §12's exemption list:
// bearer middleware protects only /v1 (and /v1/*) endpoints; every
// other path — /healthz, /, dashboard static tree, /bootstrap/*,
// /problems/*, and OPTIONS preflight regardless of path — passes
// through without DB or hasher work.
func requiresBearer(r *http.Request) bool {
	if r.Method == http.MethodOptions {
		return false
	}
	p := r.URL.Path
	if p == "/v1" {
		return true
	}
	return strings.HasPrefix(p, "/v1/")
}

func looksLikeMeowthToken(s string) bool {
	if len(s) != store.SecretTotalLen {
		return false
	}
	return strings.HasPrefix(s, "mwt_")
}

func writeUnauthorized(w http.ResponseWriter, r *http.Request) {
	_ = problem.Write(w, http.StatusUnauthorized, problem.KindUnauthorized, "", r.URL.Path)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

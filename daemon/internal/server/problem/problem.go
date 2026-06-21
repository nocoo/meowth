// Package problem implements RFC 7807 "Problem Details for HTTP APIs"
// for the meowth daemon, per docs/architecture/02-daemon-http-protocol.md
// §10. The type/title/status/detail/instance keys come straight from
// the doc; the Content-Type header is the canonical
// "application/problem+json; charset=utf-8".
//
// 02 §10 also reserves `GET /problems/<slug>` for a future human-
// readable explanation page. That route belongs to the chi router
// (Phase 3.7) and is intentionally NOT wired here.
package problem

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Kind identifies a problem slug (the value of the `type` field on
// the wire). All values must be of the form "/problems/<slug>" with
// <slug> from docs/architecture/02 §10.2.
type Kind string

const (
	KindInvalidRequest     Kind = "/problems/invalid_request"
	KindUnauthorized       Kind = "/problems/unauthorized"
	KindUnknownBackend     Kind = "/problems/unknown_backend"
	KindSessionNotFound    Kind = "/problems/session_not_found"
	KindTokenNotFound      Kind = "/problems/token_not_found"
	KindSessionConflict    Kind = "/problems/session_conflict"
	KindPayloadTooLarge    Kind = "/problems/payload_too_large"
	KindBackendUnavailable Kind = "/problems/backend_unavailable"
	KindInternal           Kind = "/problems/internal"
)

// ContentType is the canonical RFC 7807 media type.
const ContentType = "application/problem+json; charset=utf-8"

// titles maps each Kind to its short human title. The map is read-
// only; tests assert each Kind has an entry.
var titles = map[Kind]string{
	KindInvalidRequest:     "Invalid request",
	KindUnauthorized:       "Unauthorized",
	KindUnknownBackend:     "Unknown backend",
	KindSessionNotFound:    "Session not found",
	KindTokenNotFound:      "Token not found",
	KindSessionConflict:    "Session conflict",
	KindPayloadTooLarge:    "Payload too large",
	KindBackendUnavailable: "Backend unavailable",
	KindInternal:           "Internal server error",
}

// internalDetailFallback is the only detail value KindInternal ever
// emits. Real error context goes to the daemon log (which is wired
// in Phase 3.7), never to the client.
const internalDetailFallback = "internal server error"

// Body is the wire shape per 02 §10.1.
type Body struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// Write serialises a problem+json response with the given kind. The
// status MUST be the HTTP status the caller has chosen; we do not
// derive it from the kind because the same kind (e.g. internal) may
// be paired with different statuses in unusual paths.
//
// For KindInternal the supplied detail is intentionally ignored to
// avoid leaking error.Error() text; the response always returns
// "internal server error". All other kinds pass detail through.
//
// instance should normally be r.URL.Path; callers pass it explicitly
// so Write does not need an *http.Request.
func Write(w http.ResponseWriter, status int, kind Kind, detail, instance string) error {
	if w == nil {
		return errors.New("problem: nil ResponseWriter")
	}
	if kind == "" {
		return errors.New("problem: empty kind")
	}
	title, ok := titles[kind]
	if !ok {
		return fmt.Errorf("problem: unknown kind %q", kind)
	}
	if kind == KindInternal {
		detail = internalDetailFallback
	}
	body := Body{
		Type:     string(kind),
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: instance,
	}
	w.Header().Set("Content-Type", ContentType)
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	if err := enc.Encode(&body); err != nil {
		return fmt.Errorf("problem: encode: %w", err)
	}
	return nil
}

// Title returns the registered human title for the kind. Exported so
// callers building custom wrappers can reuse the registry; tests use
// it to assert every kind has a title.
func Title(kind Kind) (string, bool) {
	t, ok := titles[kind]
	return t, ok
}

// AllKinds returns every registered kind. Iteration order is
// undefined.
func AllKinds() []Kind {
	out := make([]Kind, 0, len(titles))
	for k := range titles {
		out = append(out, k)
	}
	return out
}

// SlugIsValid is a cheap sanity check used internally + by tests
// that want to assert each Kind looks like "/problems/<lowercase
// kebab-or-snake>".
func SlugIsValid(kind Kind) bool {
	s := string(kind)
	if !strings.HasPrefix(s, "/problems/") {
		return false
	}
	tail := strings.TrimPrefix(s, "/problems/")
	if tail == "" {
		return false
	}
	for i := 0; i < len(tail); i++ {
		c := tail[i]
		switch {
		case c >= 'a' && c <= 'z':
		case c >= '0' && c <= '9':
		case c == '_':
		default:
			return false
		}
	}
	return true
}

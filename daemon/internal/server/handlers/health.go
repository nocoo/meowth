// Package handlers wraps the chi-mounted HTTP endpoints for Phase 3.7.
// Each handler keeps its dependencies explicit (e.g. a *sql.DB on the
// tokens struct) so the L1 tests can wire them with httptest without
// touching the full server.New chain.
package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/nocoo/meowth/daemon/internal/server/problem"
)

// healthzResponse is the wire shape for GET /healthz per
// docs/architecture/02 §14: a single boolean field `ok`.
type healthzResponse struct {
	OK bool `json:"ok"`
}

// Healthz implements GET /healthz. Always 200 + {"ok": true} when
// reached; it does not consult DB or auth.
func Healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(healthzResponse{OK: true})
}

// NotFound is the chi-router NotFound handler; emits problem+json
// with the generic /problems/not_found kind rather than chi's
// default plaintext "404 page not found". Endpoint-specific 404
// kinds (token_not_found, session_not_found) belong to the
// corresponding handlers, NOT to this router-level catch-all.
func NotFound(w http.ResponseWriter, r *http.Request) {
	_ = problem.Write(w, http.StatusNotFound, problem.KindNotFound, "no such route", r.URL.Path)
}

// MethodNotAllowed is the chi-router MethodNotAllowed handler; emits
// problem+json with status 405. 02 §10.2 has no dedicated method-not-
// allowed kind, so we tag it as invalid_request for now; refinement
// is a docs follow-up.
func MethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	_ = problem.Write(w, http.StatusMethodNotAllowed, problem.KindInvalidRequest, "method not allowed", r.URL.Path)
}

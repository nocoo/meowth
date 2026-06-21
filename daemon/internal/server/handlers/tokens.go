package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/server/problem"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// TokensHandler bundles the dependencies the three /v1/tokens
// handlers need. Keep the surface narrow so L1 tests can construct
// it directly against an in-memory store.
type TokensHandler struct {
	DB *sql.DB
}

// NewTokensHandler is the constructor used by server.New and tests.
func NewTokensHandler(db *sql.DB) *TokensHandler {
	return &TokensHandler{DB: db}
}

// createRequest is the docs/architecture/02 §9.1 request body shape.
type createRequest struct {
	Name string `json:"name"`
}

// createResponse mirrors 02 §9.1's 201 body. `secret` appears in
// this response once and nowhere else (no GET surfaces it).
type createResponse struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Prefix     string    `json:"prefix"`
	Secret     string    `json:"secret"`
	CreatedAt  time.Time `json:"created_at"`
	CreatedVia string    `json:"created_via"`
}

// listResponse is the wire shape for GET /v1/tokens. The `tokens`
// array entries deliberately use the TokenView struct from store
// which has no secret/hash/salt fields — a compile-time wire-safety
// invariant per docs/architecture/03 §10.4.
type listResponse struct {
	Tokens []store.TokenView `json:"tokens"`
}

// deleteResponse mirrors 02 §9.3: { id, revoked_at } on 200.
type deleteResponse struct {
	ID        string    `json:"id"`
	RevokedAt time.Time `json:"revoked_at"`
}

// Create handles POST /v1/tokens. 02 §9.1 + 03 §10.1.
func (h *TokensHandler) Create(w http.ResponseWriter, r *http.Request) {
	defer func() { _ = r.Body.Close() }()
	var req createRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			_ = problem.Write(w, http.StatusRequestEntityTooLarge, problem.KindPayloadTooLarge,
				"request body exceeds the per-request size limit", r.URL.Path)
			return
		}
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "invalid JSON body", r.URL.Path)
		return
	}
	// Reject any second top-level token after the first object. The
	// canonical pattern is to Decode a sink and require io.EOF; `More()`
	// only inspects the current array/object level (an extra top-level
	// object slips past it).
	var sink json.RawMessage
	if err := dec.Decode(&sink); !errors.Is(err, io.EOF) {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "trailing data after JSON body", r.URL.Path)
		return
	}
	name := strings.TrimSpace(req.Name)
	if l := len(name); l < 1 || l > 64 {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "name must be 1..64 chars", r.URL.Path)
		return
	}

	secret, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
		return
	}
	tok, err := store.InsertToken(r.Context(), h.DB, store.InsertTokenParams{
		Name:       name,
		Prefix:     store.Prefix(secret),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaDashboard,
	})
	if err != nil {
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	// docs/architecture/02 §9.1 + docs/architecture/03 §10.4: this
	// is the one and only response that legitimately contains the
	// plaintext `secret`. gosec G117 flags the field name as
	// suspicious; the wire-safety compile-time invariant lives in
	// the TokenView projector elsewhere.
	_ = json.NewEncoder(w).Encode(createResponse{ //nolint:gosec // see comment above; 02 §9.1 one-shot secret response
		ID:         tok.ID,
		Name:       tok.Name,
		Prefix:     tok.Prefix,
		Secret:     secret,
		CreatedAt:  tok.CreatedAt,
		CreatedVia: string(tok.CreatedVia),
	})
}

// List handles GET /v1/tokens. 02 §9.2.
func (h *TokensHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := store.ListAllTokens(r.Context(), h.DB)
	if err != nil {
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
		return
	}
	views := make([]store.TokenView, 0, len(rows))
	for i := range rows {
		views = append(views, rows[i].View())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(listResponse{Tokens: views})
}

// Delete handles DELETE /v1/tokens/{id}. 02 §9.3.
func (h *TokensHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		_ = problem.Write(w, http.StatusBadRequest, problem.KindInvalidRequest, "missing id", r.URL.Path)
		return
	}
	ok, revokedAt, err := store.RevokeToken(r.Context(), h.DB, id)
	if err != nil {
		_ = problem.Write(w, http.StatusInternalServerError, problem.KindInternal, "", r.URL.Path)
		return
	}
	if !ok {
		_ = problem.Write(w, http.StatusNotFound, problem.KindTokenNotFound, "token not found or already revoked", r.URL.Path)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(deleteResponse{ID: id, RevokedAt: revokedAt})
}

package store

import "time"

// CreatedVia enumerates the legal values for tokens.created_via per
// docs/architecture/03-sqlite-schema-and-tokens.md §4.5. The DB-side
// CHECK constraint enforces this set; the Go-side constants exist so
// handlers cannot accidentally pass a wire-controlled string.
type CreatedVia string

const (
	CreatedViaInit         CreatedVia = "init"
	CreatedViaFirstRunMint CreatedVia = "first_run_mint"
	CreatedViaDashboard    CreatedVia = "dashboard"
	CreatedViaCLI          CreatedVia = "cli"
)

// IsValid returns true when v is in the documented set.
func (v CreatedVia) IsValid() bool {
	switch v {
	case CreatedViaInit, CreatedViaFirstRunMint, CreatedViaDashboard, CreatedViaCLI:
		return true
	}
	return false
}

// Token is the internal representation of a tokens row. It carries
// token_hash + salt because store code needs them for argon2 compare.
// Handlers that respond to HTTP MUST map this to TokenView (which has
// no hash/salt) before serialising; the compile-time wire-safety
// argument in docs/architecture/03 §10.4 is enforced by the type
// difference, not by JSON tags.
type Token struct {
	ID         string
	Name       string
	Prefix     string
	TokenHash  []byte
	Salt       []byte
	CreatedAt  time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
	CreatedVia CreatedVia
}

// TokenView is the public-safe projection. It deliberately lacks
// TokenHash / Salt / Secret fields so any handler that hands a
// TokenView to encoding/json cannot leak hash material or secrets.
type TokenView struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedVia CreatedVia `json:"created_via"`
}

// View returns the TokenView projection of t.
func (t *Token) View() TokenView {
	return TokenView{
		ID:         t.ID,
		Name:       t.Name,
		Prefix:     t.Prefix,
		CreatedAt:  t.CreatedAt,
		LastUsedAt: t.LastUsedAt,
		RevokedAt:  t.RevokedAt,
		CreatedVia: t.CreatedVia,
	}
}

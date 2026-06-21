package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/store/gen"
)

// InsertTokenParams carries the inputs needed to materialise a single
// tokens row. Secret bytes never enter here — only the precomputed
// hash + salt — so this signature itself documents the hash-only
// storage discipline of docs/architecture/03-sqlite-schema-and-tokens.md
// §4.1.
type InsertTokenParams struct {
	Name       string
	Prefix     string
	TokenHash  []byte
	Salt       []byte
	CreatedVia CreatedVia
}

// InsertToken writes one row to the tokens table and returns it. The
// caller is responsible for generating secret/salt/hash (via
// GenerateTokenSecret) and computing Prefix.
//
// Backed by gen.Queries.InsertToken (sqlc generated); this wrapper
// owns input validation, uuid v7 minting, and unit conversion from
// time.Time to the on-disk unix-second column.
func InsertToken(ctx context.Context, db *sql.DB, p InsertTokenParams) (*Token, error) {
	if !p.CreatedVia.IsValid() {
		return nil, fmt.Errorf("store: invalid CreatedVia %q", p.CreatedVia)
	}
	if p.Name == "" {
		return nil, errors.New("store: token name is required")
	}
	if err := ValidateTokenPrefix(p.Prefix); err != nil {
		return nil, err
	}
	if len(p.TokenHash) != int(Argon2KeyLen) {
		return nil, fmt.Errorf("store: token_hash must be %d bytes, got %d", Argon2KeyLen, len(p.TokenHash))
	}
	if len(p.Salt) != Argon2SaltLen {
		return nil, fmt.Errorf("store: salt must be %d bytes, got %d", Argon2SaltLen, len(p.Salt))
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("store: uuid v7: %w", err)
	}
	now := time.Now().UTC().Truncate(time.Second)

	if err := gen.New(db).InsertToken(ctx, gen.InsertTokenParams{
		ID:         id.String(),
		Name:       p.Name,
		Prefix:     p.Prefix,
		TokenHash:  p.TokenHash,
		Salt:       p.Salt,
		CreatedAt:  now.Unix(),
		CreatedVia: string(p.CreatedVia),
	}); err != nil {
		return nil, fmt.Errorf("store: insert token: %w", err)
	}

	return &Token{
		ID:         id.String(),
		Name:       p.Name,
		Prefix:     p.Prefix,
		TokenHash:  p.TokenHash,
		Salt:       p.Salt,
		CreatedAt:  now,
		CreatedVia: p.CreatedVia,
	}, nil
}

// ListActiveTokensByPrefix returns every non-revoked tokens row whose
// prefix matches. Multiple rows may match because prefix is not
// unique (docs/architecture/03 §4.3).
func ListActiveTokensByPrefix(ctx context.Context, db *sql.DB, prefix string) ([]Token, error) {
	rows, err := gen.New(db).ListActiveTokensByPrefix(ctx, prefix)
	if err != nil {
		return nil, fmt.Errorf("store: list tokens by prefix: %w", err)
	}
	return mapTokens(rows), nil
}

// ListAllTokens returns every tokens row ordered by created_at DESC.
// Includes revoked rows; callers decide how to filter or render.
// Used by GET /v1/tokens (Phase 3.7).
func ListAllTokens(ctx context.Context, db *sql.DB) ([]Token, error) {
	rows, err := gen.New(db).ListAllTokensOrderedByCreatedAt(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list all tokens: %w", err)
	}
	return mapTokens(rows), nil
}

// CountTokens returns the total number of rows in the tokens table,
// including revoked rows. Used by docs/architecture/04 §5.1 step 2
// to decide whether to open the first-run mint window.
func CountTokens(ctx context.Context, db *sql.DB) (int, error) {
	n, err := gen.New(db).CountTokens(ctx)
	if err != nil {
		return 0, fmt.Errorf("store: count tokens: %w", err)
	}
	return int(n), nil
}

// TouchTokenLastUsedAt updates the last_used_at column. Called from
// the bearer auth path (Phase 3.6).
func TouchTokenLastUsedAt(ctx context.Context, db *sql.DB, id string, when time.Time) error {
	whenUnix := when.UTC().Truncate(time.Second).Unix()
	if err := gen.New(db).TouchTokenLastUsedAt(ctx, gen.TouchTokenLastUsedAtParams{
		LastUsedAt: sql.NullInt64{Int64: whenUnix, Valid: true},
		ID:         id,
	}); err != nil {
		return fmt.Errorf("store: touch last_used_at: %w", err)
	}
	return nil
}

// RevokeToken sets revoked_at on a single token id. Returns whether a
// row was actually revoked, and (when ok) the timestamp written.
// docs/architecture/02 §9.3 wants the DELETE /v1/tokens/{id} response
// body to include the revoked_at timestamp, hence the second return.
func RevokeToken(ctx context.Context, db *sql.DB, id string) (bool, time.Time, error) {
	now := time.Now().UTC().Truncate(time.Second)
	n, err := gen.New(db).RevokeToken(ctx, gen.RevokeTokenParams{
		RevokedAt: sql.NullInt64{Int64: now.Unix(), Valid: true},
		ID:        id,
	})
	if err != nil {
		return false, time.Time{}, fmt.Errorf("store: revoke token: %w", err)
	}
	return n == 1, now, nil
}

func mapTokens(rows []gen.Token) []Token {
	out := make([]Token, 0, len(rows))
	for _, r := range rows {
		out = append(out, genRowToToken(r))
	}
	return out
}

func genRowToToken(r gen.Token) Token {
	t := Token{
		ID:         r.ID,
		Name:       r.Name,
		Prefix:     r.Prefix,
		TokenHash:  r.TokenHash,
		Salt:       r.Salt,
		CreatedAt:  time.Unix(r.CreatedAt, 0).UTC(),
		CreatedVia: CreatedVia(r.CreatedVia),
	}
	if r.LastUsedAt.Valid {
		ts := time.Unix(r.LastUsedAt.Int64, 0).UTC()
		t.LastUsedAt = &ts
	}
	if r.RevokedAt.Valid {
		ts := time.Unix(r.RevokedAt.Int64, 0).UTC()
		t.RevokedAt = &ts
	}
	return t
}

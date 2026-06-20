package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
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

	_, err = db.ExecContext(ctx, `
		INSERT INTO tokens (id, name, prefix, token_hash, salt, created_at, created_via)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, id.String(), p.Name, p.Prefix, p.TokenHash, p.Salt, now.Unix(), string(p.CreatedVia))
	if err != nil {
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
	rows, err := db.QueryContext(ctx, `
		SELECT id, name, prefix, token_hash, salt, created_at, last_used_at, revoked_at, created_via
		FROM tokens
		WHERE prefix = ? AND revoked_at IS NULL
	`, prefix)
	if err != nil {
		return nil, fmt.Errorf("store: list tokens by prefix: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []Token
	for rows.Next() {
		t, err := scanToken(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list tokens: %w", err)
	}
	return out, nil
}

// CountTokens returns the total number of rows in the tokens table,
// including revoked rows. Used by docs/architecture/04 §5.1 step 2
// to decide whether to open the first-run mint window.
func CountTokens(ctx context.Context, db *sql.DB) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tokens`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("store: count tokens: %w", err)
	}
	return n, nil
}

// TouchTokenLastUsedAt updates the last_used_at column. It is called
// from the bearer auth path (Phase 3.6) but exposed here so 3.4 can
// L1-cover it.
func TouchTokenLastUsedAt(ctx context.Context, db *sql.DB, id string, when time.Time) error {
	_, err := db.ExecContext(ctx, `UPDATE tokens SET last_used_at = ? WHERE id = ?`, when.UTC().Truncate(time.Second).Unix(), id)
	if err != nil {
		return fmt.Errorf("store: touch last_used_at: %w", err)
	}
	return nil
}

// RevokeToken sets revoked_at on a single token id. Returns whether a
// row was actually revoked (useful for translating to 404 in HTTP
// handlers later).
func RevokeToken(ctx context.Context, db *sql.DB, id string) (bool, error) {
	res, err := db.ExecContext(ctx, `
		UPDATE tokens SET revoked_at = ?
		WHERE id = ? AND revoked_at IS NULL
	`, time.Now().UTC().Truncate(time.Second).Unix(), id)
	if err != nil {
		return false, fmt.Errorf("store: revoke token: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: revoke token rows: %w", err)
	}
	return n == 1, nil
}

type scanFn func(dest ...any) error

func scanToken(scan scanFn) (Token, error) {
	var (
		t                           Token
		createdAtUnix               int64
		lastUsedUnix, revokedAtUnix sql.NullInt64
		createdVia                  string
	)
	if err := scan(&t.ID, &t.Name, &t.Prefix, &t.TokenHash, &t.Salt,
		&createdAtUnix, &lastUsedUnix, &revokedAtUnix, &createdVia); err != nil {
		return Token{}, fmt.Errorf("store: scan token: %w", err)
	}
	t.CreatedAt = time.Unix(createdAtUnix, 0).UTC()
	if lastUsedUnix.Valid {
		ts := time.Unix(lastUsedUnix.Int64, 0).UTC()
		t.LastUsedAt = &ts
	}
	if revokedAtUnix.Valid {
		ts := time.Unix(revokedAtUnix.Int64, 0).UTC()
		t.RevokedAt = &ts
	}
	t.CreatedVia = CreatedVia(createdVia)
	return t, nil
}

package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed migrations/*.up.sql
var embeddedMigrations embed.FS

// MigrationsFS is the embedded migration filesystem. Tests can swap in
// a different fs.FS to exercise failure modes.
var MigrationsFS fs.FS = embeddedMigrations

// migration carries one row of work for the runner.
type migration struct {
	version int
	name    string
	sql     string
}

// ApplyMigrations idempotently applies all up.sql files under
// migrations/ in monotonic version order. Already-applied versions
// (recorded in _migrations) are skipped. Each migration runs in its
// own transaction; a failing statement rolls the migration back and
// returns an error without modifying the ledger.
func ApplyMigrations(ctx context.Context, db *sql.DB, src fs.FS) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS _migrations (
			version    INTEGER PRIMARY KEY,
			name       TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("store.migrate: ensure _migrations: %w", err)
	}

	applied, err := loadApplied(ctx, db)
	if err != nil {
		return err
	}

	migs, err := loadMigrations(src)
	if err != nil {
		return err
	}

	for _, m := range migs {
		if _, ok := applied[m.version]; ok {
			continue
		}
		if err := applyOne(ctx, db, m); err != nil {
			return err
		}
	}
	return nil
}

func loadApplied(ctx context.Context, db *sql.DB) (map[int]struct{}, error) {
	rows, err := db.QueryContext(ctx, `SELECT version FROM _migrations`)
	if err != nil {
		return nil, fmt.Errorf("store.migrate: query _migrations: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make(map[int]struct{})
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("store.migrate: scan _migrations: %w", err)
		}
		out[v] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store.migrate: rows: %w", err)
	}
	return out, nil
}

func loadMigrations(src fs.FS) ([]migration, error) {
	entries, err := fs.ReadDir(src, "migrations")
	if err != nil {
		return nil, fmt.Errorf("store.migrate: read migrations dir: %w", err)
	}
	var migs []migration
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		v, err := parseVersion(name)
		if err != nil {
			return nil, err
		}
		body, err := fs.ReadFile(src, "migrations/"+name)
		if err != nil {
			return nil, fmt.Errorf("store.migrate: read %s: %w", name, err)
		}
		migs = append(migs, migration{version: v, name: name, sql: string(body)})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })
	if err := validateMonotonic(migs); err != nil {
		return nil, err
	}
	return migs, nil
}

func parseVersion(name string) (int, error) {
	// "NNN_kebab-name.up.sql" → NNN. NNN must be exactly 3 digits and
	// the part after the underscore must be a non-empty name (sans the
	// .up.sql suffix that loadMigrations already filtered on).
	parts := strings.SplitN(name, "_", 2)
	if len(parts) != 2 {
		return 0, fmt.Errorf("store.migrate: bad migration filename %q (want NNN_name.up.sql)", name)
	}
	prefix, rest := parts[0], parts[1]
	if len(prefix) != 3 {
		return 0, fmt.Errorf("store.migrate: version prefix %q in %q must be exactly 3 digits", prefix, name)
	}
	for _, c := range prefix {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("store.migrate: version prefix %q in %q must be digits", prefix, name)
		}
	}
	if rest == ".up.sql" || rest == "" {
		return 0, fmt.Errorf("store.migrate: filename %q has empty name segment", name)
	}
	v, err := strconv.Atoi(prefix)
	if err != nil {
		return 0, fmt.Errorf("store.migrate: bad version prefix in %q: %w", name, err)
	}
	if v <= 0 {
		return 0, fmt.Errorf("store.migrate: version must be > 0 (got %d in %q)", v, name)
	}
	return v, nil
}

func validateMonotonic(migs []migration) error {
	for i := 1; i < len(migs); i++ {
		if migs[i].version == migs[i-1].version {
			return fmt.Errorf("store.migrate: duplicate version %d (%s vs %s)",
				migs[i].version, migs[i-1].name, migs[i].name)
		}
	}
	return nil
}

func applyOne(ctx context.Context, db *sql.DB, m migration) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store.migrate: begin %s: %w", m.name, err)
	}
	rollback := func(cause error) error {
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return fmt.Errorf("%w (rollback: %v)", cause, rbErr)
		}
		return cause
	}
	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return rollback(fmt.Errorf("store.migrate: exec %s: %w", m.name, err))
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO _migrations(version, name, applied_at)
		VALUES (?, ?, ?)
	`, m.version, m.name, time.Now().Unix()); err != nil {
		return rollback(fmt.Errorf("store.migrate: record %s: %w", m.name, err))
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store.migrate: commit %s: %w", m.name, err)
	}
	return nil
}

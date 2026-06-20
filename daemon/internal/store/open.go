// Package store wraps the modernc.org/sqlite driver to provide a
// meowth-specific Open that:
//
//   - applies the SQLite PRAGMAs required by
//     docs/architecture/03-sqlite-schema-and-tokens.md §2.3,
//   - enforces the home/test isolation rules from §9 BEFORE applying
//     any migration, so a misconnected store is never mutated by the
//     wrong mode,
//   - runs the embedded migrations (§8) after the marker check passes,
//   - re-asserts the production marker invariant after migration in
//     case anything sneaks in during apply,
//   - and tightens DB / WAL / SHM file modes to 0600 per §2.2 with
//     hard errors rather than best-effort silence.
//
// HTTP, bearer auth, sessions, and messages are NOT in this package
// — they land with later phases (3.6+ / 3.7 / 3.11).
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"

	"github.com/nocoo/meowth/daemon/internal/home"

	// Register modernc.org/sqlite as the "sqlite" driver.
	_ "modernc.org/sqlite"
)

const driverName = "sqlite"

// DriverName is exported for tests that need to open additional
// connections via database/sql without re-importing the driver.
func DriverName() string { return driverName }

// Open materialises a SQLite database for the given home, applies the
// required PRAGMAs on every connection, verifies the D1 marker
// invariant, runs migrations, ensures DB/WAL/SHM mode 0600, and
// re-verifies the production marker invariant.
//
// The returned *sql.DB is safe for concurrent use and is the caller's
// responsibility to Close.
func Open(ctx context.Context, h *home.Home) (*sql.DB, error) {
	if h == nil {
		return nil, errors.New("store: nil home")
	}

	dsn, err := buildDSN(h.DBPath)
	if err != nil {
		return nil, fmt.Errorf("store: build dsn: %w", err)
	}
	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: sql.Open: %w", err)
	}

	if err := applyBootstrapPragmas(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	// D1 marker invariant FIRST — before any migration touches the DB.
	// This guarantees that opening the wrong mode against an existing
	// store leaves the store unmodified (no stray tokens/_migrations
	// rows planted by the wrong-mode call).
	switch h.Mode {
	case home.ModeProduction:
		if err := verifyProductionStore(ctx, db); err != nil {
			_ = db.Close()
			return nil, err
		}
	case home.ModeTest:
		if err := verifyTestStore(ctx, db); err != nil {
			_ = db.Close()
			return nil, err
		}
	default:
		_ = db.Close()
		return nil, fmt.Errorf("store: unknown home mode %v", h.Mode)
	}

	if err := ApplyMigrations(ctx, db, MigrationsFS); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: migrations: %w", err)
	}

	// Re-assert the production-side invariant: even after our own
	// migrations apply, the production DB must not contain
	// _test_marker. Defends against a future migration accidentally
	// creating it or against a stale test marker that somehow slipped
	// past the pre-migration check.
	if h.Mode == home.ModeProduction {
		if err := verifyProductionStore(ctx, db); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("store: post-migration marker check: %w", err)
		}
	}

	// File-mode enforcement is a hard contract per docs/architecture/03 §2.2
	// (0600 on the DB and any WAL/SHM sidecars). DB file must exist after
	// the migrations above. WAL/SHM are SQLite-created and may not exist
	// yet on a fresh empty DB; missing is OK, but if they exist and we
	// cannot chmod them we surface the error rather than silently
	// downgrading the safety property.
	if err := home.EnsureFileMode(h.DBPath, home.FileMode); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: chmod db file: %w", err)
	}
	for _, p := range []string{h.DBPath + "-wal", h.DBPath + "-shm"} {
		_, statErr := os.Stat(p)
		switch {
		case statErr == nil:
			if err := home.EnsureFileMode(p, home.FileMode); err != nil {
				_ = db.Close()
				return nil, fmt.Errorf("store: chmod %s: %w", p, err)
			}
		case errors.Is(statErr, os.ErrNotExist):
			// sidecar not yet materialised — fine; whoever creates it
			// next will land under the same 0700 parent dir, and the
			// next Open will tighten the mode.
		default:
			_ = db.Close()
			return nil, fmt.Errorf("store: stat %s: %w", p, statErr)
		}
	}

	return db, nil
}

// EnsureTestMarker creates the meowth-test sentinel row in the
// _test_marker table. It is exported so tests / harness code can call
// it on a freshly opened test DB before Open runs verifyTestStore.
// Production code must never call this — Open in ModeProduction
// refuses to see the table at all (§9.2).
func EnsureTestMarker(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS _test_marker (
			marker TEXT PRIMARY KEY CHECK (marker = 'meowth-test')
		);
		INSERT OR IGNORE INTO _test_marker(marker) VALUES ('meowth-test');
	`)
	if err != nil {
		return fmt.Errorf("store: EnsureTestMarker: %w", err)
	}
	return nil
}

func buildDSN(path string) (string, error) {
	// modernc.org/sqlite reads DSN parameters from the URI query. We
	// build the file URI through net/url so paths containing reserved
	// URI characters (?, #, space, etc.) do not silently truncate or
	// re-interpret the SQLite open path. Using URL.Path (not Opaque)
	// is what triggers the per-segment percent-escape we need.
	u := &url.URL{Scheme: "file", Path: path}
	q := url.Values{}
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	q.Add("_pragma", "foreign_keys(ON)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "temp_store(MEMORY)")
	q.Add("_pragma", "cache_size(-65536)")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func applyBootstrapPragmas(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA synchronous  = NORMAL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA temp_store   = MEMORY`,
		`PRAGMA cache_size   = -65536`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("store: pragma %q: %w", s, err)
		}
	}
	return nil
}

func verifyProductionStore(ctx context.Context, db *sql.DB) error {
	var n int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name = '_test_marker'
	`).Scan(&n)
	if err != nil {
		return fmt.Errorf("store: production marker check: %w", err)
	}
	if n != 0 {
		return errors.New("store: refusing to open: production store contains _test_marker table (looks like a test DB)")
	}
	return nil
}

func verifyTestStore(ctx context.Context, db *sql.DB) error {
	// Check that the table exists first so we can return a clear error
	// distinct from "table missing entirely" vs "table empty".
	var tableExists int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name = '_test_marker'
	`).Scan(&tableExists)
	if err != nil {
		return fmt.Errorf("store: test marker table check: %w", err)
	}
	if tableExists == 0 {
		return errors.New("store: refusing to open: test store missing _test_marker table (call EnsureTestMarker first)")
	}
	var marker string
	err = db.QueryRowContext(ctx, `SELECT marker FROM _test_marker LIMIT 1`).Scan(&marker)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("store: refusing to open: test store missing _test_marker row (call EnsureTestMarker first)")
	}
	if err != nil {
		return fmt.Errorf("store: test marker check: %w", err)
	}
	if marker != "meowth-test" {
		return fmt.Errorf("store: refusing to open: unexpected marker value %q", marker)
	}
	return nil
}

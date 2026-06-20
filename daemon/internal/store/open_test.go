package store

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/nocoo/meowth/daemon/internal/home"
)

// openTestStore is the standard test helper used by every store test:
// it provisions a private MEOWTH_TEST=1 home under t.TempDir(), opens
// the store, and registers cleanup. The returned *sql.DB is fully
// migrated and has the _test_marker row in place.
func openTestStore(t *testing.T) *sql.DB {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))

	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	// Materialise the test marker BEFORE Open so verifyTestStore is happy.
	dsn, err := buildDSN(h.DBPath)
	if err != nil {
		t.Fatalf("buildDSN: %v", err)
	}
	bootstrapDB, err := sql.Open(driverName, dsn)
	if err != nil {
		t.Fatalf("bootstrap sql.Open: %v", err)
	}
	if err := EnsureTestMarker(context.Background(), bootstrapDB); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bootstrapDB.Close()

	db, err := Open(context.Background(), h)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestOpenAppliesPragmasAndMigrations(t *testing.T) {
	db := openTestStore(t)
	ctx := context.Background()

	// PRAGMAs.
	want := map[string]string{
		"journal_mode": "wal",
		"foreign_keys": "1",
		"busy_timeout": "5000",
		"temp_store":   "2", // MEMORY
		"cache_size":   "-65536",
		"synchronous":  "1", // NORMAL
	}
	for k, exp := range want {
		var got string
		if err := db.QueryRowContext(ctx, "PRAGMA "+k).Scan(&got); err != nil {
			t.Fatalf("read PRAGMA %s: %v", k, err)
		}
		if !strings.EqualFold(got, exp) {
			t.Fatalf("PRAGMA %s = %q, want %q", k, got, exp)
		}
	}

	// Schema.
	for _, table := range []string{"tokens", "_migrations", "_test_marker"} {
		var n int
		if err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&n); err != nil {
			t.Fatalf("schema check %s: %v", table, err)
		}
		if n != 1 {
			t.Fatalf("table %s missing", table)
		}
	}

	// Ledger reflects the embedded migration.
	var max int
	if err := db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM _migrations`,
	).Scan(&max); err != nil {
		t.Fatalf("ledger: %v", err)
	}
	if max < 1 {
		t.Fatalf("expected at least migration 1 applied, got max=%d", max)
	}
}

func TestProductionStoreRejectsTestMarker(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	// MEOWTH_TEST off — Production() resolves under tmp/.meowth.
	t.Setenv("MEOWTH_TEST", "")

	h, err := home.Production()
	if err != nil {
		t.Fatalf("home.Production: %v", err)
	}

	// Seed the production DB file with the test marker table, then Open.
	dsn, err := buildDSN(h.DBPath)
	if err != nil {
		t.Fatalf("buildDSN: %v", err)
	}
	bootstrap, err := sql.Open(driverName, dsn)
	if err != nil {
		t.Fatalf("bootstrap open: %v", err)
	}
	if err := EnsureTestMarker(ctx, bootstrap); err != nil {
		t.Fatalf("seed marker: %v", err)
	}
	_ = bootstrap.Close()

	if _, err := Open(ctx, h); err == nil {
		t.Fatal("Open(production) accepted a DB containing _test_marker (expected refusal)")
	} else if !strings.Contains(err.Error(), "_test_marker") {
		t.Fatalf("expected '_test_marker' refusal, got %v", err)
	}
}

func TestTestStoreRequiresMarker(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))

	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	// Deliberately DO NOT call EnsureTestMarker — Open must refuse.
	if _, err := Open(ctx, h); err == nil {
		t.Fatal("Open(test) without marker: want refusal, got nil")
	} else if !strings.Contains(err.Error(), "marker") {
		t.Fatalf("expected marker refusal, got %v", err)
	}

	// Critical D1 invariant: rejection happens BEFORE migrations, so
	// the wrongly-opened DB must have no tokens / _migrations tables.
	bootstrap, err := sql.Open(driverName, "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = bootstrap.Close() }()
	for _, table := range []string{"tokens", "_migrations"} {
		var n int
		if err := bootstrap.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&n); err != nil {
			t.Fatalf("post-refuse schema check %s: %v", table, err)
		}
		if n != 0 {
			t.Fatalf("rejected Open(test) still created table %q", table)
		}
	}
}

func TestProductionStoreRejectsTestMarkerLeavesDBUnmigrated(t *testing.T) {
	ctx := context.Background()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "")

	h, err := home.Production()
	if err != nil {
		t.Fatalf("home.Production: %v", err)
	}
	bootstrap, err := sql.Open(driverName, "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("bootstrap open: %v", err)
	}
	if err := EnsureTestMarker(ctx, bootstrap); err != nil {
		t.Fatalf("seed marker: %v", err)
	}
	_ = bootstrap.Close()

	if _, err := Open(ctx, h); err == nil {
		t.Fatal("Open(production) accepted test marker")
	}

	// D1 invariant: the wrongly-opened production call must NOT plant
	// production tables into the test-marked DB.
	reopen, err := sql.Open(driverName, "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = reopen.Close() }()
	for _, table := range []string{"tokens", "_migrations"} {
		var n int
		if err := reopen.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&n); err != nil {
			t.Fatalf("post-refuse schema check %s: %v", table, err)
		}
		if n != 0 {
			t.Fatalf("rejected Open(production) still created table %q", table)
		}
	}
}

func TestOpenSurvivesDSNPathWithReservedCharacters(t *testing.T) {
	// MEOWTH_TEST_HOME containing reserved URI chars (?, #, space)
	// would previously truncate the SQLite open path. With url.URL
	// escaping the DB must land at exactly h.DBPath.
	ctx := context.Background()
	tmp := t.TempDir()
	weirdRoot := filepath.Join(tmp, "weird? #path with spaces")
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", weirdRoot)

	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}

	bootstrapDSN, err := buildDSN(h.DBPath)
	if err != nil {
		t.Fatalf("buildDSN: %v", err)
	}
	bootstrap, err := sql.Open(driverName, bootstrapDSN)
	if err != nil {
		t.Fatalf("bootstrap sql.Open: %v", err)
	}
	if err := EnsureTestMarker(ctx, bootstrap); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bootstrap.Close()

	db, err := Open(ctx, h)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	// File must exist exactly at the expected path; truncation would
	// have created the file at "weird".
	info, err := os.Stat(h.DBPath)
	if err != nil {
		t.Fatalf("expected DB at %q, stat: %v", h.DBPath, err)
	}
	if info.IsDir() {
		t.Fatalf("DB path resolved to a directory")
	}
}

func TestEnsureFileModeChmodFailureSurfacesError(t *testing.T) {
	// Ensure the contract: home.EnsureFileMode propagates stat errors.
	// We use a path that does not exist; Open calls this for DB after
	// migration so an inaccessible file must surface as an error.
	if err := home.EnsureFileMode(filepath.Join(t.TempDir(), "absent"), home.FileMode); err == nil {
		t.Fatal("EnsureFileMode on missing file must error")
	}
}

func TestOpenSetsDBFileMode0600(t *testing.T) {
	db := openTestStore(t)
	_ = db
	// Find the DB file via the test marker path: openTestStore wrote it
	// under MEOWTH_TEST_HOME, which is t.TempDir()/.meowth-test/meowth-test.db.
	// We re-derive via env to avoid leaking the helper's internal state.
	dbPath := filepath.Join(os.Getenv("MEOWTH_TEST_HOME"), "meowth-test.db")
	info, err := os.Stat(dbPath) //nolint:gosec // dbPath is derived from MEOWTH_TEST_HOME which this test itself set under t.TempDir()
	if err != nil {
		t.Fatalf("stat db: %v", err)
	}
	if info.Mode().Perm() != home.FileMode {
		t.Fatalf("db mode = %v, want %v", info.Mode().Perm(), home.FileMode)
	}
}

func TestApplyMigrationsIsIdempotent(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)

	// Apply again — should be a no-op (no new ledger rows, no error).
	var before int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM _migrations`).Scan(&before); err != nil {
		t.Fatalf("ledger before: %v", err)
	}
	if err := ApplyMigrations(ctx, db, MigrationsFS); err != nil {
		t.Fatalf("ApplyMigrations second call: %v", err)
	}
	var after int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM _migrations`).Scan(&after); err != nil {
		t.Fatalf("ledger after: %v", err)
	}
	if after != before {
		t.Fatalf("ledger grew from %d to %d on second apply", before, after)
	}
}

func TestApplyMigrationsRollsBackOnFailure(t *testing.T) {
	ctx := context.Background()
	db := openTestStore(t)

	// Use a synthetic FS whose 999 migration intentionally fails.
	bad := fstest.MapFS{
		"migrations/999_intentional_failure.up.sql": {
			Data: []byte(`THIS IS NOT VALID SQL ;`),
		},
	}
	err := ApplyMigrations(ctx, db, bad)
	if err == nil {
		t.Fatal("expected ApplyMigrations to fail on bad SQL")
	}
	// Ledger must not record the failed migration.
	var n int
	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM _migrations WHERE version = 999`,
	).Scan(&n); err != nil {
		t.Fatalf("ledger query: %v", err)
	}
	if n != 0 {
		t.Fatalf("ledger recorded failed migration 999 (n=%d)", n)
	}
}

func TestLoadMigrationsRejectsBadFilenames(t *testing.T) {
	bad := fstest.MapFS{
		"migrations/no-version.up.sql": {Data: []byte("CREATE TABLE x(a INTEGER);")},
	}
	if _, err := loadMigrations(bad); err == nil {
		t.Fatal("loadMigrations accepted filename without NNN_ prefix")
	}
}

func TestLoadMigrationsRequiresThreeDigitVersion(t *testing.T) {
	for _, bad := range []string{
		"migrations/1_short.up.sql",
		"migrations/12_two.up.sql",
		"migrations/1234_four.up.sql",
	} {
		fsys := fstest.MapFS{bad: {Data: []byte("CREATE TABLE x(a INTEGER);")}}
		if _, err := loadMigrations(fsys); err == nil {
			t.Fatalf("loadMigrations accepted non-3-digit prefix %q", bad)
		}
	}
}

func TestLoadMigrationsRejectsEmptyName(t *testing.T) {
	fsys := fstest.MapFS{
		"migrations/001_.up.sql": {Data: []byte("CREATE TABLE x(a INTEGER);")},
	}
	if _, err := loadMigrations(fsys); err == nil {
		t.Fatal("loadMigrations accepted empty name segment")
	}
}

func TestLoadMigrationsRejectsDuplicateVersions(t *testing.T) {
	bad := fstest.MapFS{
		"migrations/001_a.up.sql": {Data: []byte("CREATE TABLE a(x INTEGER);")},
		"migrations/001_b.up.sql": {Data: []byte("CREATE TABLE b(x INTEGER);")},
	}
	if _, err := loadMigrations(bad); err == nil {
		t.Fatal("loadMigrations accepted duplicate version 001")
	}
}

func TestOpenRefusesNilHome(t *testing.T) {
	if _, err := Open(context.Background(), nil); err == nil {
		t.Fatal("Open(nil) accepted; want refusal")
	}
}

// migrationsFSIsRealEmbedded asserts the embedded FS reports the
// production migration list. Acts as a guard against forgotten //go:embed
// directives or build flag drift.
func TestMigrationsFSIsRealEmbedded(t *testing.T) {
	entries, err := fs.ReadDir(MigrationsFS, "migrations")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("embedded migrations is empty (go:embed not picking files?)")
	}
	for _, e := range entries {
		if e.IsDir() {
			t.Fatalf("unexpected sub-directory in migrations: %s", e.Name())
		}
	}
}

// Helper kept here so tests can wrap small errors when asserting type.
var _ = errors.New

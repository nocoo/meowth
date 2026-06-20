package bootstraptoken

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/initcmd"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// initializedHome resolves a fresh test home and runs `meowthd init`
// (path A) so the bootstrap-token tests start from the same world the
// CLI expects: home exists, DB exists, tokens table has the bootstrap
// row from init.
func initializedHome(t *testing.T) *home.Home {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.ResolveTest()
	if err != nil {
		t.Fatalf("home.ResolveTest: %v", err)
	}
	var stdout bytes.Buffer
	if err := initcmd.Run(context.Background(), h, initcmd.Options{}, &stdout); err != nil {
		t.Fatalf("seed init: %v", err)
	}
	return h
}

// emptyResolvedHome returns a test home that has NOT been provisioned;
// used for the "missing home" / "missing db" refusal tests.
func emptyResolvedHome(t *testing.T) *home.Home {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.ResolveTest()
	if err != nil {
		t.Fatalf("home.ResolveTest: %v", err)
	}
	return h
}

func TestRunMintsNewTokenOnInitializedHome(t *testing.T) {
	h := initializedHome(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "mwt_") {
		t.Fatalf("stdout missing mwt_ token: %q", out)
	}
	if !strings.Contains(out, "Emergency bootstrap token created") {
		t.Fatalf("stdout missing banner copy: %q", out)
	}
	if !strings.Contains(out, DashboardURL) {
		t.Fatalf("stdout missing Dashboard URL %q: %q", DashboardURL, out)
	}
}

func TestRunWritesCLICreatedViaRow(t *testing.T) {
	h := initializedHome(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}

	db := openExistingTestStore(t, h)
	defer func() { _ = db.Close() }()
	ctx := context.Background()

	// The fresh row's plaintext was just printed in stdout; its prefix
	// is the first 9 chars of the first stdout line.
	lines := strings.SplitN(stdout.String(), "\n", 2)
	if len(lines) < 1 || !strings.HasPrefix(lines[0], "mwt_") {
		t.Fatalf("could not extract mwt_ secret from stdout: %q", stdout.String())
	}
	prefix := store.Prefix(lines[0])
	got, err := store.ListActiveTokensByPrefix(ctx, db, prefix)
	if err != nil {
		t.Fatalf("ListActiveTokensByPrefix: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 active token with prefix %q, got %d", prefix, len(got))
	}
	if got[0].CreatedVia != store.CreatedViaCLI {
		t.Fatalf("created_via = %q, want %q", got[0].CreatedVia, store.CreatedViaCLI)
	}
	if got[0].Name != DefaultName {
		t.Fatalf("name = %q, want %q", got[0].Name, DefaultName)
	}
}

func TestRunSucceedsEvenWhenTokensExist(t *testing.T) {
	h := initializedHome(t) // already has the init bootstrap row
	// Run bootstrap-token twice; both must succeed and we should end
	// with exactly two CLI-origin rows in addition to the init row.
	for i := 0; i < 2; i++ {
		var stdout bytes.Buffer
		if err := Run(context.Background(), h, Options{}, &stdout); err != nil {
			t.Fatalf("Run #%d: %v", i, err)
		}
	}
	db := openExistingTestStore(t, h)
	defer func() { _ = db.Close() }()

	var cliCount int
	if err := db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM tokens WHERE created_via='cli'`,
	).Scan(&cliCount); err != nil {
		t.Fatalf("count cli: %v", err)
	}
	if cliCount != 2 {
		t.Fatalf("cli-origin tokens = %d, want 2", cliCount)
	}
}

func TestRunRefusesMissingHome(t *testing.T) {
	h := emptyResolvedHome(t)
	var stdout bytes.Buffer
	err := Run(context.Background(), h, Options{}, &stdout)
	if err == nil {
		t.Fatal("Run on missing home: want refusal, got nil")
	}
	if !strings.Contains(err.Error(), "home") || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing-home refusal, got %v", err)
	}
}

func TestRunRefusesMissingDB(t *testing.T) {
	h := emptyResolvedHome(t)
	// Provision the home but NOT the DB so we can prove the second
	// refusal branch fires.
	if err := h.Ensure(); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	var stdout bytes.Buffer
	err := Run(context.Background(), h, Options{}, &stdout)
	if err == nil {
		t.Fatal("Run on missing db: want refusal, got nil")
	}
	if !strings.Contains(err.Error(), "store") || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing-store refusal, got %v", err)
	}
}

func TestRunRefusesNilWriter(t *testing.T) {
	h := initializedHome(t)
	if err := Run(context.Background(), h, Options{}, nil); err == nil {
		t.Fatal("nil writer accepted")
	}
}

type failingWriter struct{ err error }

func (f failingWriter) Write(_ []byte) (int, error) { return 0, f.err }

func TestRunSurfacesStdoutFailure(t *testing.T) {
	h := initializedHome(t)
	err := Run(context.Background(), h, Options{}, failingWriter{err: errors.New("pipe closed")})
	if err == nil {
		t.Fatal("failing writer: want error, got nil")
	}
	if !strings.Contains(err.Error(), "stdout banner") {
		t.Fatalf("expected stdout banner error, got %v", err)
	}
	// Even on banner failure the row landed in DB (Path C contract:
	// surface the failure, the caller can re-run and produce another
	// emergency token; no transactional rollback is promised).
	db := openExistingTestStore(t, h)
	defer func() { _ = db.Close() }()
	var n int
	if err := db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM tokens WHERE created_via='cli'`,
	).Scan(&n); err != nil {
		t.Fatalf("count cli: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 cli row even after banner failure, got %d", n)
	}
}

// openExistingTestStore reopens the test store for assertions in
// tests that already provisioned it. It bypasses the bootstrap test-
// marker step because the marker was already created by initcmd.
func openExistingTestStore(t *testing.T, h *home.Home) *sql.DB {
	t.Helper()
	dsn, err := buildTestDSN(h.DBPath)
	if err != nil {
		t.Fatalf("dsn: %v", err)
	}
	db, err := sql.Open(store.DriverName(), dsn)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	return db
}

func buildTestDSN(path string) (string, error) {
	u := &url.URL{Scheme: "file", Path: path}
	return u.String(), nil
}

// Silence the unused-import linter when only some test paths exercise os.
var _ = os.Stat

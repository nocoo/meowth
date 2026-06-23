package initcmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/setupnonce"
)

// scope sets a private test home for one test body. Returns the
// resolved (un-Ensured) Home; Run() will provision.
func scope(t *testing.T) *home.Home {
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

func TestRunDefaultCreatesRootToken(t *testing.T) {
	h := scope(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{SkipToken: false}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Banner contains a mwt_ token and the dashboard URL.
	out := stdout.String()
	if !strings.Contains(out, "mwt_") {
		t.Fatalf("stdout missing mwt_ token: %q", out)
	}
	if !strings.Contains(out, DashboardURL) {
		t.Fatalf("stdout missing dashboard URL: %q", out)
	}
	// No setup_nonce.hash should exist in path A.
	if _, err := os.Stat(h.SetupNoncePath); err == nil {
		t.Fatalf("setup_nonce.hash should not exist in path A")
	}
	// config.toml exists at 0600.
	info, err := os.Stat(h.ConfigPath)
	if err != nil {
		t.Fatalf("stat config.toml: %v", err)
	}
	if info.Mode().Perm() != home.FileMode {
		t.Fatalf("config.toml mode = %v, want %v", info.Mode().Perm(), home.FileMode)
	}
	// docs/architecture/05 §2.2: config carries the explicit local
	// block — not the legacy placeholder comment.
	body, err := os.ReadFile(h.ConfigPath)
	if err != nil {
		t.Fatalf("read config.toml: %v", err)
	}
	for _, frag := range []string{
		"[remote_access]",
		`mode            = "local"`,
		`bind_addr       = "127.0.0.1"`,
		`bind_port       = 7040`,
		`acknowledged_by = ""`,
	} {
		if !strings.Contains(string(body), frag) {
			t.Fatalf("config.toml missing %q in:\n%s", frag, string(body))
		}
	}
	// DB exists.
	if _, err := os.Stat(h.DBPath); err != nil {
		t.Fatalf("stat db: %v", err)
	}
}

func TestRunSkipTokenCreatesNonceFileAndNoToken(t *testing.T) {
	h := scope(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{SkipToken: true}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "mws_") {
		t.Fatalf("stdout missing mws_ setup-code: %q", out)
	}
	if strings.Contains(out, "mwt_") {
		t.Fatalf("stdout leaked an mwt_ token in path B: %q", out)
	}
	// setup_nonce.hash exists at 0600.
	info, err := os.Stat(h.SetupNoncePath)
	if err != nil {
		t.Fatalf("stat nonce: %v", err)
	}
	if info.Mode().Perm() != home.FileMode {
		t.Fatalf("nonce mode = %v, want %v", info.Mode().Perm(), home.FileMode)
	}
}

func TestRunSkipTokenWritesValidJSONSchema(t *testing.T) {
	h := scope(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{SkipToken: true}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}
	p, err := setupnonce.Parse(h.SetupNoncePath)
	if err != nil {
		t.Fatalf("setupnonce.Parse: %v", err)
	}
	pl := p.Payload
	if pl.Algorithm != "argon2id" {
		t.Fatalf("algorithm = %q, want argon2id", pl.Algorithm)
	}
	if pl.Version != 19 || pl.MemoryKiB != 65536 || pl.TimeCost != 3 || pl.Parallelism != 4 {
		t.Fatalf("argon parameters drifted: %+v", pl)
	}
	if !pl.OneShot {
		t.Fatal("one_shot must be true")
	}
	if pl.CreatedAt == 0 {
		t.Fatal("created_at not set")
	}
	if len(p.Salt) != 16 {
		t.Fatalf("salt length = %d, want 16", len(p.Salt))
	}
	if len(p.Digest) != 32 {
		t.Fatalf("digest length = %d, want 32", len(p.Digest))
	}
}

func TestRunSkipTokenNonceDoesNotContainPlaintext(t *testing.T) {
	h := scope(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{SkipToken: true}, &stdout); err != nil {
		t.Fatalf("Run: %v", err)
	}
	body, err := os.ReadFile(h.SetupNoncePath) //nolint:gosec // path is owned by initcmd under MEOWTH_TEST_HOME the test set up
	if err != nil {
		t.Fatalf("read nonce: %v", err)
	}
	// stdout contained the plaintext setup-code; the on-disk JSON must NOT.
	parts := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(parts) == 0 {
		t.Fatal("stdout empty")
	}
	plaintext := parts[0]
	if !strings.HasPrefix(plaintext, "mws_") {
		t.Fatalf("first stdout line is not a setup-code: %q", plaintext)
	}
	if bytes.Contains(body, []byte(plaintext)) {
		t.Fatalf("nonce file contains plaintext setup-code")
	}
}

func TestRunRefusesIfHomeNonEmpty(t *testing.T) {
	h := scope(t)
	if err := os.MkdirAll(h.Root, home.DirMode); err != nil {
		t.Fatalf("seed root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(h.Root, "stale"), []byte("x"), home.FileMode); err != nil {
		t.Fatalf("seed stale file: %v", err)
	}
	var stdout bytes.Buffer
	err := Run(context.Background(), h, Options{}, &stdout)
	if err == nil {
		t.Fatal("Run on non-empty home: want refusal, got nil")
	}
	if !strings.Contains(err.Error(), "refusing to run") {
		t.Fatalf("error message lacks refusal: %v", err)
	}
}

func TestRunIsRefusedOnSecondCall(t *testing.T) {
	h := scope(t)
	var stdout bytes.Buffer
	if err := Run(context.Background(), h, Options{}, &stdout); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	if err := Run(context.Background(), h, Options{}, &stdout); err == nil {
		t.Fatal("second Run: want refusal, got nil")
	}
}

func TestRunRefusesNilWriter(t *testing.T) {
	h := scope(t)
	if err := Run(context.Background(), h, Options{}, nil); err == nil {
		t.Fatal("Run with nil stdout: want refusal, got nil")
	}
}

func TestWriteSetupNonceRejectsBadInputs(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "nonce.hash")
	if err := setupnonce.Write(path, make([]byte, 8), make([]byte, 32)); err == nil {
		t.Fatal("short salt accepted")
	}
	if err := setupnonce.Write(path, make([]byte, 16), make([]byte, 8)); err == nil {
		t.Fatal("short digest accepted")
	}
}

// failingWriter returns err after writing nothing; used to simulate
// broken stdout (closed pipe, redirected file gone, etc).
type failingWriter struct{ err error }

func (f failingWriter) Write(_ []byte) (int, error) { return 0, f.err }

func TestRunDefaultSurfacesStdoutFailure(t *testing.T) {
	h := scope(t)
	err := Run(context.Background(), h, Options{}, failingWriter{err: errors.New("pipe closed")})
	if err == nil {
		t.Fatal("Run path A with failing stdout: want error, got nil")
	}
	if !strings.Contains(err.Error(), "stdout banner") {
		t.Fatalf("expected stdout banner error, got %v", err)
	}
}

func TestRunSkipTokenSurfacesStdoutFailure(t *testing.T) {
	h := scope(t)
	err := Run(context.Background(), h, Options{SkipToken: true}, failingWriter{err: errors.New("pipe closed")})
	if err == nil {
		t.Fatal("Run path B with failing stdout: want error, got nil")
	}
	if !strings.Contains(err.Error(), "stdout banner") {
		t.Fatalf("expected stdout banner error, got %v", err)
	}
	// Even when banner fails, the nonce should still have landed on
	// disk (path B writes the file BEFORE the banner). The amend's
	// contract is "surface the error", not "transactional rollback".
	if _, err := os.Stat(h.SetupNoncePath); err != nil {
		t.Fatalf("expected setup_nonce.hash to remain on disk after banner failure: %v", err)
	}
}

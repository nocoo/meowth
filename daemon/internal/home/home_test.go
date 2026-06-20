package home

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withTestMode is a helper that scopes a `MEOWTH_TEST=1` env var to the
// test body and unsets it on cleanup, even when the parent shell did
// not have it. Tests that want to leave MEOWTH_TEST unset should not
// call this helper.
func withTestMode(t *testing.T) {
	t.Helper()
	t.Setenv("MEOWTH_TEST", "1")
}

func TestProductionRootResolvesUnderUserHome(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	// Defensive: even with MEOWTH_TEST_HOME set, Production() must not honour it.
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, "should-not-leak"))

	h, err := Production()
	if err != nil {
		t.Fatalf("Production: %v", err)
	}
	want := filepath.Join(tmp, ".meowth")
	if h.Root != want {
		t.Fatalf("Root = %q, want %q", h.Root, want)
	}
	if h.Mode != ModeProduction {
		t.Fatalf("Mode = %v, want ModeProduction", h.Mode)
	}
	if filepath.Base(h.DBPath) != "meowth.db" {
		t.Fatalf("DBPath base = %q, want meowth.db", filepath.Base(h.DBPath))
	}
}

func TestProductionRequiresNoTestEnv(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1") // present but Production() must still resolve to ~/.meowth, not ~/.meowth-test
	h, err := Production()
	if err != nil {
		t.Fatalf("Production: %v", err)
	}
	if filepath.Base(h.Root) != ".meowth" {
		t.Fatalf("Root base = %q, want .meowth", filepath.Base(h.Root))
	}
}

func TestTestRefusesWithoutMeowthTestFlag(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	// MEOWTH_TEST not set
	t.Setenv("MEOWTH_TEST", "")
	if _, err := Test(); err == nil {
		t.Fatalf("Test() succeeded without MEOWTH_TEST=1")
	}
}

func TestTestDefaultsToHomeMeowthTest(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST_HOME", "")
	withTestMode(t)

	h, err := Test()
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	want := filepath.Join(tmp, ".meowth-test")
	if h.Root != want {
		t.Fatalf("Root = %q, want %q", h.Root, want)
	}
	if filepath.Base(h.DBPath) != "meowth-test.db" {
		t.Fatalf("DBPath base = %q, want meowth-test.db", filepath.Base(h.DBPath))
	}
}

func TestTestHonoursMeowthTestHomeOverride(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", filepath.Join(tmp, "should-not-be-used"))
	override := filepath.Join(tmp, "custom-test-root")
	t.Setenv("MEOWTH_TEST_HOME", override)
	withTestMode(t)

	h, err := Test()
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	// Override is authoritative; substring rules are intentionally not
	// applied, so the override directory name need not contain "-test".
	if h.Root != override {
		t.Fatalf("Root = %q, want %q (MEOWTH_TEST_HOME override)", h.Root, override)
	}
}

func TestEnsureDirCreatesAt0700(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "nested", "leaf")
	if err := EnsureDir(target, DirMode); err != nil {
		t.Fatalf("EnsureDir: %v", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != DirMode {
		t.Fatalf("mode = %v, want %v", info.Mode().Perm(), DirMode)
	}
}

func TestEnsureDirFixesLooseMode(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "loose")
	if err := os.MkdirAll(target, 0o755); err != nil { //nolint:gosec // test intentionally seeds a too-wide directory to verify EnsureDir's chmod path.
		t.Fatalf("seed: %v", err)
	}
	if err := EnsureDir(target, DirMode); err != nil {
		t.Fatalf("EnsureDir: %v", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != DirMode {
		t.Fatalf("mode = %v, want %v", info.Mode().Perm(), DirMode)
	}
}

func TestEnsureDirRefusesNonDirectory(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "file-not-dir")
	if err := os.WriteFile(target, []byte("x"), 0o600); err != nil { //nolint:gosec // test seed write under t.TempDir()
		t.Fatalf("seed: %v", err)
	}
	err := EnsureDir(target, DirMode)
	if err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("EnsureDir = %v, want 'not a directory' error", err)
	}
}

func TestEnsureFileModeFixesLooseMode(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "loose-file")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil { //nolint:gosec // test seeds an intentionally too-wide file to verify chmod path
		t.Fatalf("seed: %v", err)
	}
	if err := EnsureFileMode(target, FileMode); err != nil {
		t.Fatalf("EnsureFileMode: %v", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != FileMode {
		t.Fatalf("mode = %v, want %v", info.Mode().Perm(), FileMode)
	}
}

func TestEnsureFileModeMissingFileErrors(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "absent")
	if err := EnsureFileMode(target, FileMode); err == nil {
		t.Fatal("EnsureFileMode on missing file: want error, got nil")
	}
}

func TestEnsureFileModeRefusesDirectory(t *testing.T) {
	tmp := t.TempDir()
	if err := EnsureFileMode(tmp, FileMode); err == nil {
		t.Fatal("EnsureFileMode on directory: want error, got nil")
	}
}

func TestProductionEnsureProvisionsSubdirs(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	h, err := Production()
	if err != nil {
		t.Fatalf("Production: %v", err)
	}
	for _, d := range []string{h.Root, h.RuntimeDir, h.LogsDir} {
		info, err := os.Stat(d)
		if err != nil {
			t.Fatalf("stat %s: %v", d, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s is not a directory", d)
		}
		if info.Mode().Perm() != DirMode {
			t.Fatalf("%s mode = %v, want %v", d, info.Mode().Perm(), DirMode)
		}
	}
}

func TestHomeSubpathsAreUnderRoot(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	h, err := Production()
	if err != nil {
		t.Fatalf("Production: %v", err)
	}
	for name, p := range map[string]string{
		"DBPath":         h.DBPath,
		"ConfigPath":     h.ConfigPath,
		"LogsDir":        h.LogsDir,
		"RuntimeDir":     h.RuntimeDir,
		"PidPath":        h.PidPath,
		"SetupNoncePath": h.SetupNoncePath,
	} {
		rel, err := filepath.Rel(h.Root, p)
		if err != nil {
			t.Fatalf("rel %s (%s): %v", name, p, err)
		}
		if strings.HasPrefix(rel, "..") {
			t.Fatalf("%s = %q escapes root %q", name, p, h.Root)
		}
	}
}

func TestProductionAndTestRootsAreDisjoint(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	withTestMode(t)
	t.Setenv("MEOWTH_TEST_HOME", "")

	prod, err := Production()
	if err != nil {
		t.Fatalf("Production: %v", err)
	}
	test, err := Test()
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if prod.Root == test.Root {
		t.Fatalf("production and test roots collided: %q", prod.Root)
	}
	// Equality, not substring: defense against false sense of security
	// when a directory like /tmp/foo-test/.meowth is used in production.
	if filepath.Clean(prod.Root) == filepath.Clean(test.Root) {
		t.Fatalf("cleaned paths still equal")
	}
}

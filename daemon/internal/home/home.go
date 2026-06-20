// Package home resolves and provisions meowth's local-state root
// directories (~/.meowth in production, ~/.meowth-test in tests).
//
// Per docs/architecture/03-sqlite-schema-and-tokens.md §2:
//   - Root directory is 0700.
//   - Files inside (DB / config.toml / pid / setup_nonce.hash) are 0600.
//   - Production and test stores must be path-disjoint: production
//     code never resolves under the test root, and test code never
//     resolves under the production root (D1 isolation, §9).
package home

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	// DirMode is the canonical permission for meowth-owned directories
	// (root, runtime/, logs/).
	DirMode os.FileMode = 0o700
	// FileMode is the canonical permission for meowth-owned files
	// (DB, WAL, SHM, config.toml, setup_nonce.hash, pid).
	FileMode os.FileMode = 0o600
)

// Mode distinguishes a production home from a test home. The two roots
// are never interchangeable: a production resolver MUST NOT return a
// test root and vice versa.
type Mode int

const (
	ModeProduction Mode = iota
	ModeTest
)

// Home describes a resolved meowth state root and the subpaths
// derived from it. All paths are absolute and cleaned.
type Home struct {
	Mode           Mode
	Root           string
	DBPath         string
	ConfigPath     string
	LogsDir        string
	RuntimeDir     string
	PidPath        string
	SetupNoncePath string
}

// Production returns the canonical production home rooted at
// $HOME/.meowth. The MEOWTH_TEST_HOME override is intentionally
// ignored here; it is only honoured by Test() and only when
// MEOWTH_TEST=1 is set.
func Production() (*Home, error) {
	h, err := ResolveProduction()
	if err != nil {
		return nil, err
	}
	if err := h.Ensure(); err != nil {
		return nil, err
	}
	return h, nil
}

// ResolveProduction resolves the production Home without creating any
// directories. Callers (e.g. `meowthd init`) that need to enforce
// pre-existing-home invariants BEFORE provisioning use this; ordinary
// daemon code should keep using Production().
func ResolveProduction() (*Home, error) {
	root, err := userHomeJoin(".meowth")
	if err != nil {
		return nil, err
	}
	return newHome(ModeProduction, root, "meowth.db")
}

// Test returns a test home rooted at MEOWTH_TEST_HOME (when MEOWTH_TEST=1)
// or $HOME/.meowth-test otherwise. The DB file is meowth-test.db so the
// _test_marker check (docs/architecture/03 §9) can distinguish stores
// even when paths are passed around.
//
// Test() returns an error when invoked outside MEOWTH_TEST=1: there is
// no legitimate reason to provision a test home in production-mode
// processes, and refusing here closes that drift early.
func Test() (*Home, error) {
	h, err := ResolveTest()
	if err != nil {
		return nil, err
	}
	if err := h.Ensure(); err != nil {
		return nil, err
	}
	return h, nil
}

// ResolveTest is the no-Ensure analogue of Test(); see ResolveProduction
// for rationale.
func ResolveTest() (*Home, error) {
	if os.Getenv("MEOWTH_TEST") != "1" {
		return nil, errors.New("home: Test() requires MEOWTH_TEST=1")
	}
	root, err := resolveTestRoot()
	if err != nil {
		return nil, err
	}
	return newHome(ModeTest, root, "meowth-test.db")
}

// Ensure provisions the root and runtime/logs subdirectories at 0700,
// fixing the mode in place if a pre-existing directory is too open.
// Files are not touched here; their permissions are enforced at create
// time by the writers (store.Open, init).
func (h *Home) Ensure() error {
	for _, d := range []string{h.Root, h.RuntimeDir, h.LogsDir} {
		if err := EnsureDir(d, DirMode); err != nil {
			return err
		}
	}
	return nil
}

// EnsureDir creates dir at mode if missing, or chmod's it to mode if
// present with looser permissions. Returns an error if the path
// exists and is not a directory.
func EnsureDir(dir string, mode os.FileMode) error {
	info, err := os.Stat(dir)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(dir, mode); err != nil {
			return fmt.Errorf("home: mkdir %s: %w", dir, err)
		}
		// MkdirAll honours umask; re-chmod to be explicit.
		if err := os.Chmod(dir, mode); err != nil {
			return fmt.Errorf("home: chmod %s: %w", dir, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("home: stat %s: %w", dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("home: %s exists but is not a directory", dir)
	}
	if info.Mode().Perm() != mode {
		if err := os.Chmod(dir, mode); err != nil {
			return fmt.Errorf("home: chmod %s: %w", dir, err)
		}
	}
	return nil
}

// EnsureFileMode chmods path to mode if it exists with looser
// permissions. Missing files are not created. Used by store.Open
// after SQLite materialises DB/WAL/SHM, and by callers that need to
// re-assert FileMode on hand-written files.
func EnsureFileMode(path string, mode os.FileMode) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("home: stat %s: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("home: %s is a directory, not a file", path)
	}
	if info.Mode().Perm() != mode {
		if err := os.Chmod(path, mode); err != nil {
			return fmt.Errorf("home: chmod %s: %w", path, err)
		}
	}
	return nil
}

func newHome(mode Mode, root, dbFile string) (*Home, error) {
	abs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return nil, fmt.Errorf("home: abs %s: %w", root, err)
	}
	runtimeDir := filepath.Join(abs, "runtime")
	return &Home{
		Mode:           mode,
		Root:           abs,
		DBPath:         filepath.Join(abs, dbFile),
		ConfigPath:     filepath.Join(abs, "config.toml"),
		LogsDir:        filepath.Join(abs, "logs"),
		RuntimeDir:     runtimeDir,
		PidPath:        filepath.Join(runtimeDir, "meowthd.pid"),
		SetupNoncePath: filepath.Join(runtimeDir, "setup_nonce.hash"),
	}, nil
}

func userHomeJoin(name string) (string, error) {
	uh, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home: os.UserHomeDir: %w", err)
	}
	return filepath.Join(uh, name), nil
}

func resolveTestRoot() (string, error) {
	if override := os.Getenv("MEOWTH_TEST_HOME"); override != "" {
		return override, nil
	}
	return userHomeJoin(".meowth-test")
}

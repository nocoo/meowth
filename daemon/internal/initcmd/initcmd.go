// Package initcmd implements the `meowthd init` subcommand
// described in docs/architecture/04-bootstrap-and-first-run-mint.md
// §3 (path A) and §4.1 (path B / --skip-token).
//
// Both paths share the same idempotency check, directory layout, and
// migration apply; they differ only in what they produce for the
// caller to capture: path A prints the freshly-minted root token,
// path B prints a setup-code and persists its argon2 digest in
// setup_nonce.hash.
//
// HTTP, bearer auth, and the actual POST /bootstrap/mint endpoint
// are out of scope (3.6 / 3.8 / task #5). `meowthd bootstrap-token`
// is also out of scope (lands as 3.5a in this same task).
package initcmd

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Options carries the toggles `meowthd init` accepts. New flags
// should land here so the call sites in cmd/meowthd stay small.
type Options struct {
	// SkipToken selects path B (setup-code + setup_nonce.hash) over
	// path A (immediate root token).
	SkipToken bool
}

// DashboardURL is what the stdout banner advertises after init
// completes. Hardcoded here per docs/architecture/04 §3.1 step 6 and
// §4.1 step 6; will move to config when 05 (remote_access) lands.
const DashboardURL = "http://127.0.0.1:7777"

// minimalConfigToml is the placeholder body for ~/.meowth/config.toml.
// Phase 05 / 3.9 fills in real [remote_access] schema; until then the
// file just exists at 0600 to anchor the contract that the init
// process owns its presence.
const minimalConfigToml = "# meowth daemon config (placeholder; populated by docs/architecture/05 in Phase 3.9)\n"

// Run executes the init command end-to-end. It returns a non-nil
// error if the home is non-empty (idempotency), the store cannot
// open, or any of the writes fail. Stdout is captured by the caller
// so tests can inspect the printed banner.
func Run(ctx context.Context, h *home.Home, opts Options, stdout io.Writer) error {
	if h == nil {
		return errors.New("initcmd: nil home")
	}
	if stdout == nil {
		return errors.New("initcmd: nil stdout writer")
	}

	if err := ensureHomeAbsent(h.Root); err != nil {
		return err
	}

	if err := h.Ensure(); err != nil {
		return err
	}
	if err := writeConfigStub(h); err != nil {
		return err
	}

	db, err := openStore(ctx, h)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	if opts.SkipToken {
		return runSkipToken(ctx, h, stdout)
	}
	return runDefault(ctx, db, stdout)
}

// ensureHomeAbsent enforces docs/architecture/04 §3.1 step 1 / §4.1
// step 1: if the home root exists with any content (even a single
// dotfile), refuse. Empty pre-existing dir is treated as absent so
// the test harness can pre-create temp roots via MEOWTH_TEST_HOME.
func ensureHomeAbsent(root string) error {
	entries, err := os.ReadDir(root)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return nil
	case err != nil:
		return fmt.Errorf("initcmd: stat %s: %w", root, err)
	}
	if len(entries) == 0 {
		return nil
	}
	return fmt.Errorf(
		"initcmd: refusing to run: %s already exists with %d entries; "+
			"clean it manually or use `meowthd bootstrap-token` (Phase 3.5a) to inject a new token",
		root, len(entries))
}

func writeConfigStub(h *home.Home) error {
	if err := os.WriteFile(h.ConfigPath, []byte(minimalConfigToml), home.FileMode); err != nil {
		return fmt.Errorf("initcmd: write config.toml: %w", err)
	}
	// Belt + braces: os.WriteFile honours umask; re-chmod to be explicit
	// about the docs/architecture/03 §2.2 0600 contract.
	if err := home.EnsureFileMode(h.ConfigPath, home.FileMode); err != nil {
		return err
	}
	return nil
}

func openStore(ctx context.Context, h *home.Home) (*sql.DB, error) {
	if h.Mode == home.ModeTest {
		// Test mode: the marker must exist before store.Open succeeds,
		// and Phase 3.4 explicitly keeps EnsureTestMarker outside the
		// production migration list. Materialise it via a bootstrap
		// connection here so test harnesses do not have to interleave
		// their own DB setup with initcmd.
		dsn, err := buildBootstrapDSN(h.DBPath)
		if err != nil {
			return nil, err
		}
		bs, err := sql.Open(store.DriverName(), dsn)
		if err != nil {
			return nil, fmt.Errorf("initcmd: bootstrap open: %w", err)
		}
		if err := store.EnsureTestMarker(ctx, bs); err != nil {
			_ = bs.Close()
			return nil, err
		}
		_ = bs.Close()
	}
	return store.Open(ctx, h)
}

func runDefault(ctx context.Context, db *sql.DB, stdout io.Writer) error {
	secret, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		return err
	}
	tok, err := store.InsertToken(ctx, db, store.InsertTokenParams{
		Name:       "bootstrap",
		Prefix:     store.Prefix(secret),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaInit,
	})
	if err != nil {
		return err
	}
	_ = tok // intentional: id/created_at not needed for stdout banner
	// Path A: the token is now hash-only on disk; the plaintext exists
	// only inside `secret` and the banner. If stdout fails (broken pipe,
	// disk full on the captured tty, redirected file gone) the user
	// will never see the plaintext, the home is non-empty, and the
	// idempotency check will refuse a second `init`. We must surface
	// this failure so the operator knows to use `meowthd bootstrap-token`
	// (Phase 3.5a) rather than silently exit 0.
	if err := printRootTokenBanner(stdout, secret); err != nil {
		return fmt.Errorf("initcmd: stdout banner: %w", err)
	}
	return nil
}

func runSkipToken(ctx context.Context, h *home.Home, stdout io.Writer) error {
	_ = ctx // setup-code generation is purely local; no DB writes here
	code, salt, digest, err := store.GenerateSetupCode()
	if err != nil {
		return err
	}
	if err := WriteSetupNonce(h.SetupNoncePath, salt, digest); err != nil {
		return err
	}
	// Path B: setup_nonce.hash now persists the argon2 digest, but the
	// plaintext setup-code exists only inside `code` and the banner. A
	// silently-swallowed stdout failure would lock the operator into a
	// usable mint window with no usable setup-code; surface it.
	if err := printSetupCodeBanner(stdout, code); err != nil {
		return fmt.Errorf("initcmd: stdout banner: %w", err)
	}
	return nil
}

func printRootTokenBanner(w io.Writer, secret string) error {
	// One-shot stdout per docs/architecture/04 §3.1 step 6.
	var b bytes.Buffer
	fmt.Fprintln(&b, secret)
	fmt.Fprintln(&b, "Dashboard:", DashboardURL)
	fmt.Fprintln(&b, "把上面的 token 粘贴到 dashboard 的 token 输入框。")
	fmt.Fprintln(&b, "token 只显示这一次，请立即保存。")
	_, err := w.Write(b.Bytes())
	return err
}

func printSetupCodeBanner(w io.Writer, code string) error {
	// One-shot stdout per docs/architecture/04 §4.1 step 6.
	var b bytes.Buffer
	fmt.Fprintln(&b, code)
	fmt.Fprintln(&b, "Dashboard:", DashboardURL)
	fmt.Fprintln(&b, "在 dashboard /setup 页面输入上面的 setup-code 完成首个 token mint。")
	fmt.Fprintln(&b, "setup-code 只显示这一次，请立即保存（脚本化部署可重定向到密钥库）。")
	_, err := w.Write(b.Bytes())
	return err
}

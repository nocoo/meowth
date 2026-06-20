// Package bootstraptoken implements `meowthd bootstrap-token`, the
// emergency CLI path defined by docs/architecture/04-bootstrap-and-
// first-run-mint.md §8 / §2 ("应急通路").
//
// Unlike `meowthd init`:
//   - it requires an existing home + opened store (it does NOT
//     provision the home),
//   - it does NOT consult tokens emptiness (it deliberately works
//     even when other tokens exist — that is the whole point),
//   - it does NOT touch setup_nonce.hash and is independent of the
//     mint window,
//   - it does NOT consult remote_access (independent of network mode),
//   - it writes a new tokens row with created_via='cli'.
//
// The HTTP daemon, mint endpoint, and the lockout / remote_access
// semantics remain out of scope (Phase 3.6+ / task #5).
package bootstraptoken

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// Options exists for symmetry with initcmd and so future flags
// (e.g. --name <label>) have a documented landing point.
type Options struct{}

// DefaultName is the tokens.name value written by the emergency CLI
// path. Docs/architecture/04 §2 calls this an "emergency bootstrap".
const DefaultName = "emergency bootstrap"

// DashboardURL mirrors initcmd.DashboardURL — duplicated here as a
// const (rather than imported) to avoid a cross-cmd dependency on a
// peer subcommand. docs/architecture/04 §8.2 step 5 requires the
// stdout banner advertise it alongside the secret.
const DashboardURL = "http://127.0.0.1:7777"

// Run executes the bootstrap-token CLI end-to-end. The home must
// already exist (and own a meowth-managed DB); a missing home or
// store surfaces as a clear error so the operator can either run
// `meowthd init` (path A) or manually fix the home.
//
// On success Run prints the freshly-minted root token to stdout
// exactly once and returns nil.
func Run(ctx context.Context, h *home.Home, _ Options, stdout io.Writer) error {
	if h == nil {
		return errors.New("bootstraptoken: nil home")
	}
	if stdout == nil {
		return errors.New("bootstraptoken: nil stdout writer")
	}

	if err := requireExistingHome(h); err != nil {
		return err
	}

	db, err := store.Open(ctx, h)
	if err != nil {
		return fmt.Errorf("bootstraptoken: open store: %w", err)
	}
	defer func() { _ = db.Close() }()

	secret, salt, hash, err := store.GenerateTokenSecret()
	if err != nil {
		return err
	}
	if _, err := store.InsertToken(ctx, db, store.InsertTokenParams{
		Name:       DefaultName,
		Prefix:     store.Prefix(secret),
		TokenHash:  hash,
		Salt:       salt,
		CreatedVia: store.CreatedViaCLI,
	}); err != nil {
		return fmt.Errorf("bootstraptoken: insert: %w", err)
	}

	// Surface stdout failures: an emergency token whose plaintext the
	// operator never received is worse than a clean refusal — they can
	// re-run the same command and produce another.
	if err := printBanner(stdout, secret); err != nil {
		return fmt.Errorf("bootstraptoken: stdout banner: %w", err)
	}
	return nil
}

// requireExistingHome refuses early when the home root or the DB
// file is missing, with a message that points the operator at
// `meowthd init` rather than letting store.Open fail mid-way.
func requireExistingHome(h *home.Home) error {
	if _, err := os.Stat(h.Root); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf(
				"bootstraptoken: refusing to run: home %s does not exist; "+
					"run `meowthd init` (or `meowthd init --skip-token`) first to provision it",
				h.Root)
		}
		return fmt.Errorf("bootstraptoken: stat home: %w", err)
	}
	if _, err := os.Stat(h.DBPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf(
				"bootstraptoken: refusing to run: store %s does not exist; "+
					"run `meowthd init` first to create it",
				h.DBPath)
		}
		return fmt.Errorf("bootstraptoken: stat db: %w", err)
	}
	return nil
}

func printBanner(w io.Writer, secret string) error {
	// One-shot stdout per docs/architecture/04 §2 / §8.2 step 5.
	// §8.2 explicitly requires the Dashboard URL on the same banner
	// as the secret so an operator with only stdout has the full
	// recovery payload in one place.
	var b bytes.Buffer
	fmt.Fprintln(&b, secret)
	fmt.Fprintln(&b, "Dashboard:", DashboardURL)
	fmt.Fprintln(&b, "Emergency bootstrap token created (created_via=cli).")
	fmt.Fprintln(&b, "token 只显示这一次，请立即保存。")
	_, err := w.Write(b.Bytes())
	return err
}

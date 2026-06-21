package mint

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/setupnonce"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// ProbeInput collects the dependencies Probe needs to make the
// docs/architecture/04 §5.1 startup decision.
type ProbeInput struct {
	Home    *home.Home
	DB      *sql.DB
	IsLocal bool
	Logger  *slog.Logger
}

// Probe runs the §5.1 step 1–6 decision. The return contract is:
//
//	(*MintWindow, nil)  → window should be mounted by server.New
//	(nil, nil)           → window should NOT be mounted; reason logged
//	(nil, error)         → daemon startup failure (IO error etc.);
//	                       caller should exit non-zero
//
// Probe performs the §5.3 stale-cleanup os.Remove when tokens are
// non-empty and a nonce file exists. Remove failure is logged at
// WARN but does NOT block daemon startup.
//
// Probe NEVER writes the nonce file and only removes it in the
// stale-cleanup branch. invalid-nonce / no-nonce-file paths leave
// the file untouched per §5.1 step 4.
func Probe(ctx context.Context, in ProbeInput) (*MintWindow, error) {
	if in.Home == nil {
		return nil, errors.New("mint: nil home")
	}
	if in.DB == nil {
		return nil, errors.New("mint: nil db")
	}
	logger := in.Logger
	if logger == nil {
		logger = slog.Default()
	}

	// §5.1 step 1 — remote_access.mode must be local. If not, do
	// not even consider mounting the endpoint. Document the reason
	// in the startup log.
	if !in.IsLocal {
		logger.Info("first-run mint window: CLOSED", "reason", "remote_access_mode")
		return nil, nil
	}

	// §5.1 step 2 — tokens table non-empty closes the window
	// permanently (§5.3 stale cleanup if a stray nonce file is
	// present).
	count, err := store.CountTokens(ctx, in.DB)
	if err != nil {
		return nil, fmt.Errorf("mint: count tokens: %w", err)
	}
	if count > 0 {
		if _, statErr := os.Stat(in.Home.SetupNoncePath); statErr == nil {
			if removeErr := os.Remove(in.Home.SetupNoncePath); removeErr != nil {
				logger.Warn(
					"failed to clean stale setup_nonce.hash; will retry on next startup",
					"err", removeErr,
					"path", in.Home.SetupNoncePath,
				)
			} else {
				logger.Info("cleaned stale setup_nonce.hash", "reason", "token_exists")
			}
		}
		logger.Info("first-run mint window: CLOSED", "reason", "token_exists")
		return nil, nil
	}

	// §5.1 step 3 — nonce file must exist.
	if _, statErr := os.Stat(in.Home.SetupNoncePath); errors.Is(statErr, os.ErrNotExist) {
		logger.Info("first-run mint window: CLOSED", "reason", "no_nonce_file")
		return nil, nil
	} else if statErr != nil {
		return nil, fmt.Errorf("mint: stat nonce: %w", statErr)
	}

	// §5.1 step 4 — parse and validate the file. Failure does NOT
	// delete the file (so the operator can debug; recovery via
	// `meowthd bootstrap-token`).
	parsed, err := setupnonce.Parse(in.Home.SetupNoncePath)
	if err != nil {
		logger.Info(
			"first-run mint window: CLOSED",
			"reason", "nonce_invalid",
			"err", err,
		)
		return nil, nil
	}

	// §5.1 step 5 — algorithm / one_shot guard. Parse already
	// enforces both; defence in depth in Open.
	w, err := Open(parsed, in.Home.SetupNoncePath, logger)
	if err != nil {
		logger.Info(
			"first-run mint window: CLOSED",
			"reason", "nonce_invalid",
			"err", err,
		)
		return nil, nil
	}

	// §5.1 step 6 — window OPEN.
	logger.Info("first-run mint window: OPEN")
	return w, nil
}

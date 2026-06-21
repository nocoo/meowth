// Package mint implements the daemon-side `POST /bootstrap/mint`
// state machine per docs/architecture/04 §5–§7.
//
// MintWindow is the in-memory window object the daemon loads at
// startup (via Probe) when path B's setup_nonce.hash is present
// and the prerequisites in §5.1 are all satisfied. Once loaded the
// window owns:
//
//   - the argon2id parameters / salt / digest the request body is
//     compared against,
//   - the failure counter that drives §7 lockout (5 strikes),
//   - the Closed flag the handler / server probe check to short-
//     circuit further requests.
//
// docs/architecture/04 §6.3 step 4 mandates that the "argon2 hit →
// locked re-check (tokens + nonce file) → InsertToken → file
// remove → Closed=true" sequence is one atomic operation under
// MintWindow.Mu. Window.Consume accepts a callback that performs
// the DB work under the same Mu so that orchestration cannot leak
// out of this package.
package mint

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"golang.org/x/crypto/argon2"

	"github.com/nocoo/meowth/daemon/internal/setupnonce"
)

// MaxFailures is the docs/architecture/04 §7.1 lockout threshold:
// the 5th failure within a process lifetime flips Closed=true and
// removes the nonce file.
const MaxFailures = 5

// MintWindow is the in-memory mint state shared by handler and
// startup probe. Construct via Open; direct literals are an error
// outside test fixtures.
type MintWindow struct {
	algorithm   string
	version     uint32
	memoryKiB   uint32
	timeCost    uint32
	parallelism uint8
	salt        []byte
	digest      []byte
	noncePath   string
	logger      *slog.Logger

	mu           sync.Mutex
	failureCount int
	closed       bool
}

// Open builds a MintWindow from a parsed setup_nonce.hash. Inputs
// are validated again (defence in depth — Parse already enforced
// these) so an accidentally-constructed Parsed cannot smuggle
// degenerate state past the constructor.
func Open(parsed *setupnonce.Parsed, noncePath string, logger *slog.Logger) (*MintWindow, error) {
	if parsed == nil {
		return nil, errors.New("mint: nil parsed nonce")
	}
	if noncePath == "" {
		return nil, errors.New("mint: empty nonce path")
	}
	if logger == nil {
		logger = slog.Default()
	}
	pl := parsed.Payload
	if pl.Algorithm != "argon2id" {
		return nil, fmt.Errorf("mint: unsupported algorithm %q", pl.Algorithm)
	}
	if !pl.OneShot {
		return nil, errors.New("mint: one_shot must be true")
	}
	if pl.MemoryKiB == 0 || pl.TimeCost == 0 || pl.Parallelism == 0 {
		return nil, errors.New("mint: argon2 cost parameters must be > 0")
	}
	if len(parsed.Salt) == 0 || len(parsed.Digest) == 0 {
		return nil, errors.New("mint: salt/digest must be non-empty")
	}
	return &MintWindow{
		algorithm:   pl.Algorithm,
		version:     pl.Version,
		memoryKiB:   pl.MemoryKiB,
		timeCost:    pl.TimeCost,
		parallelism: pl.Parallelism,
		salt:        parsed.Salt,
		digest:      parsed.Digest,
		noncePath:   noncePath,
		logger:      logger,
	}, nil
}

// IsClosed reports whether the window has consumed its one-shot
// mint or been lockout'd. Safe to call from any goroutine.
func (w *MintWindow) IsClosed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed
}

// NoncePath exposes the on-disk nonce file path so the server
// startup probe can perform §5.3 stale cleanup without reaching
// into the unexported field.
func (w *MintWindow) NoncePath() string { return w.noncePath }

// ConsumeOutcome enumerates the four reasons Consume can fail.
// Callers translate to the same 404 wire shape per §6.5.
type ConsumeOutcome int

const (
	// OutcomeOK is returned when the callback ran successfully and
	// the nonce was consumed.
	OutcomeOK ConsumeOutcome = iota
	// OutcomeFormatError is returned when the supplied setup-code
	// fails docs/architecture/04 §6.3 step 2 (length / prefix).
	// Counts toward §7 FailureCount and is jittered.
	OutcomeFormatError
	// OutcomeMismatch is returned when the argon2 digest does not
	// match. Counts toward §7 FailureCount and is jittered.
	OutcomeMismatch
	// OutcomeRecheckFailed is returned when the locked re-check
	// (tokens != empty or nonce file gone) fired. Does NOT count
	// and does NOT jitter — this is concurrent / state-change
	// territory, not an attack.
	OutcomeRecheckFailed
	// OutcomeClosed is returned when the window was already closed
	// (lockout or already consumed). Does NOT count and does NOT
	// jitter.
	OutcomeClosed
	// OutcomeInternal is returned when the callback itself returned
	// an error (DB IO etc.). Does NOT count and does NOT jitter.
	OutcomeInternal
)

// ConsumeRequest is the input to Consume. setupCode is the raw
// body field; do is the orchestrator's commit callback (DB tx +
// INSERT + COMMIT). do runs INSIDE MintWindow.Mu so the
// "re-check + insert + commit" sequence is one atomic step.
//
// do is only invoked after argon2 has succeeded AND the locked
// re-check has passed. If do returns an error the window remains
// open (Closed stays false; failure count is unchanged); the
// caller's wire response is OutcomeInternal → 404.
type ConsumeRequest struct {
	SetupCode string
	// Recheck performs the §6.3 step 4a SQL EXISTS check. Implemented
	// by the handler so the mint package does not depend on the
	// SQL driver directly. Return true iff tokens table is still
	// empty.
	Recheck func(ctx context.Context) (tokensEmpty bool, err error)
	// Commit performs the §6.3 step 4b–4d INSERT-in-tx work. It
	// receives the argon2-validated setup-code so it can mint the
	// token's secret/hash/salt and write the row. Return error to
	// signal OutcomeInternal.
	Commit func(ctx context.Context) error
}

// Consume runs the §6.3 step 1–5 happy path AND the §6.5 failure
// outcomes under MintWindow.Mu. It does not jitter — that lives in
// the handler so jitter can be skipped during tests via a Sleep
// hook.
//
// The contract is:
//
//	OutcomeOK             → Commit fired and returned nil.
//	                        nonce file removed (best-effort log on
//	                        failure), Closed flipped to true.
//	OutcomeFormatError    → setup-code length or prefix wrong.
//	                        FailureCount++; ≥ MaxFailures → lockout.
//	OutcomeMismatch       → argon2 digest disagreed.
//	                        FailureCount++; ≥ MaxFailures → lockout.
//	OutcomeRecheckFailed  → recheck returned tokensEmpty=false.
//	                        not counted; window left open.
//	OutcomeClosed         → window already closed before this call.
//	                        not counted.
//	OutcomeInternal       → Recheck or Commit returned an error.
//	                        window left open.
//
// The second return value is a string suffix safe to log under the
// "reason" key (never contains the setup-code).
func (w *MintWindow) Consume(ctx context.Context, req ConsumeRequest) (ConsumeOutcome, string) {
	// Cheap shape check: length + prefix. Done before grabbing the
	// lock so a flood of malformed bodies cannot serialise behind a
	// slow argon2 computation. The failure counter increment still
	// happens under Mu below.
	if !validSetupCodeShape(req.SetupCode) {
		return w.recordCountedFailure("format")
	}

	// Argon2 itself does not need the lock; the comparison is the
	// CPU-heavy step and parallel attackers would be rate-limited
	// by Mu otherwise. The result is checked under the lock so the
	// FailureCount and the Closed flip remain race-free.
	computed := argon2.IDKey(
		[]byte(req.SetupCode),
		w.salt,
		w.timeCost,
		w.memoryKiB,
		w.parallelism,
		uint32(len(w.digest)), //nolint:gosec // digest length is bounded by setupnonce.Parse (≤ 32 bytes); fits in uint32
	)
	digestMatches := subtle.ConstantTimeCompare(computed, w.digest) == 1

	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return OutcomeClosed, "closed"
	}

	if !digestMatches {
		w.failureCount++
		if w.failureCount >= MaxFailures {
			w.lockoutLocked()
		}
		return OutcomeMismatch, "mismatch"
	}

	// argon2 matched. The §6.3 step 4 re-check must happen under Mu
	// so concurrent successful mints cannot double-insert.
	tokensEmpty, err := req.Recheck(ctx)
	if err != nil {
		return OutcomeInternal, "recheck_failed"
	}
	if !tokensEmpty {
		// Some other path (concurrent mint, init, bootstrap-token)
		// populated the tokens table. Do not count, do not jitter.
		return OutcomeRecheckFailed, "tokens_nonempty"
	}
	if _, err := os.Stat(w.noncePath); err != nil {
		// The nonce file was removed underneath us (concurrent
		// success). Mirror the docs §6.3 step 4a treatment.
		return OutcomeRecheckFailed, "nonce_missing"
	}

	if err := req.Commit(ctx); err != nil {
		// docs/architecture/04 §6.3: token insert must succeed
		// before nonce removal. If Commit failed (DB IO error),
		// leave the window open so the user can retry; the file
		// still on disk preserves the mint window for the next
		// request.
		return OutcomeInternal, "commit_failed"
	}

	// docs/architecture/04 §6.3 step 4e/4f: remove the nonce file
	// AFTER COMMIT succeeds. Failure is logged at CRITICAL but
	// does NOT roll back the INSERT — the next daemon start does
	// the §5.3 stale cleanup.
	if err := os.Remove(w.noncePath); err != nil {
		w.logger.Error(
			"CRITICAL failed to remove setup_nonce.hash after mint; will be cleaned at next startup",
			"err", err,
			"path", w.noncePath,
		)
	}
	w.closed = true
	return OutcomeOK, "minted"
}

// lockoutLocked performs the §7.2 lockout sequence. Must be called
// with w.mu held.
func (w *MintWindow) lockoutLocked() {
	w.closed = true
	if err := os.Remove(w.noncePath); err != nil {
		w.logger.Error(
			"CRITICAL failed to remove setup_nonce.hash after lockout; manual cleanup required",
			"err", err,
			"path", w.noncePath,
		)
	}
	w.logger.Info(
		"first-run mint window: CLOSED",
		"reason", "locked_out",
		"failure_count", w.failureCount,
	)
}

// recordCountedFailure handles the "format error before argon2"
// branch. Identical bookkeeping to mismatch, separate outcome.
func (w *MintWindow) recordCountedFailure(reason string) (ConsumeOutcome, string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return OutcomeClosed, "closed"
	}
	w.failureCount++
	if w.failureCount >= MaxFailures {
		w.lockoutLocked()
	}
	return OutcomeFormatError, reason
}

// SetupCodeTotalLen is the §4.1 step 4 contract: `mws_` + 39 = 43.
const SetupCodeTotalLen = 43

// SetupCodePrefix is the bytes that must lead a valid setup-code.
const SetupCodePrefix = "mws_"

func validSetupCodeShape(s string) bool {
	if len(s) != SetupCodeTotalLen {
		return false
	}
	if s[:4] != SetupCodePrefix {
		return false
	}
	for i := 4; i < len(s); i++ {
		c := s[i]
		// RFC 4648 base32 alphabet: A-Z and 2-7.
		switch {
		case c >= 'A' && c <= 'Z':
		case c >= '2' && c <= '7':
		default:
			return false
		}
	}
	return true
}

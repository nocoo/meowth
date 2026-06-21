package mint

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/argon2"

	"github.com/nocoo/meowth/daemon/internal/setupnonce"
	"github.com/nocoo/meowth/daemon/internal/store"
)

// scratchWindow builds a MintWindow with a real argon2 digest for
// the supplied setup-code. The salt is fixed so tests are
// deterministic. The nonce file is materialised so Consume can
// os.Remove it under the happy path.
func scratchWindow(t *testing.T, setupCode string) (*MintWindow, string) {
	t.Helper()
	tmp := t.TempDir()
	path := filepath.Join(tmp, "setup_nonce.hash")
	salt := make([]byte, store.Argon2SaltLen)
	for i := range salt {
		salt[i] = byte(i + 1)
	}
	digest := computeArgon2(t, setupCode, salt)
	if err := setupnonce.Write(path, salt, digest); err != nil {
		t.Fatalf("Write: %v", err)
	}
	parsed, err := setupnonce.Parse(path)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	w, err := Open(parsed, path, logger)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return w, path
}

func computeArgon2(t *testing.T, setupCode string, salt []byte) []byte {
	t.Helper()
	return argon2Hash(setupCode, salt)
}

// argon2Hash mirrors the production digest derivation; we re-import
// argon2 here rather than calling the unexported helper to keep
// the L1 surface independent.
func argon2Hash(setupCode string, salt []byte) []byte {
	return argon2.IDKey([]byte(setupCode), salt, store.Argon2Time, store.Argon2Memory, store.Argon2Parallelism, store.Argon2KeyLen)
}

// passthroughRecheck is a Recheck callback that always passes.
func passthroughRecheck(_ context.Context) (bool, error) { return true, nil }

// nilCommit is a Commit callback that always succeeds without
// touching a DB; used when the test only cares about the outcome
// type.
func nilCommit(_ context.Context) error { return nil }

// fakeCommit returns a Commit callback that records whether it ran.
func fakeCommit(called *bool) func(context.Context) error {
	return func(_ context.Context) error {
		*called = true
		return nil
	}
}

func TestOpenRejectsBadInputs(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	if _, err := Open(nil, "/tmp", logger); err == nil {
		t.Fatal("Open accepted nil parsed")
	}
	salt := make([]byte, store.Argon2SaltLen)
	digest := make([]byte, store.Argon2KeyLen)
	parsed := &setupnonce.Parsed{
		Payload: setupnonce.Payload{
			Algorithm:   "argon2id",
			Version:     19,
			MemoryKiB:   65536,
			TimeCost:    3,
			Parallelism: 4,
			OneShot:     true,
		},
		Salt:   salt,
		Digest: digest,
	}
	if _, err := Open(parsed, "", logger); err == nil {
		t.Fatal("Open accepted empty noncePath")
	}

	bad := *parsed
	bad.Payload.Algorithm = "sha256"
	if _, err := Open(&bad, "/tmp", logger); err == nil {
		t.Fatal("Open accepted non-argon2id algorithm")
	}

	bad = *parsed
	bad.Payload.OneShot = false
	if _, err := Open(&bad, "/tmp", logger); err == nil {
		t.Fatal("Open accepted one_shot=false")
	}

	bad = *parsed
	bad.Payload.MemoryKiB = 0
	if _, err := Open(&bad, "/tmp", logger); err == nil {
		t.Fatal("Open accepted memory_kib=0")
	}
}

func TestConsumeHappyPathClosesWindowAndRemovesNonce(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, path := scratchWindow(t, setupCode)
	called := false
	out, reason := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   passthroughRecheck,
		Commit:    fakeCommit(&called),
	})
	if out != OutcomeOK {
		t.Fatalf("outcome = %v (reason=%s), want OutcomeOK", out, reason)
	}
	if !called {
		t.Fatal("Commit callback was not invoked")
	}
	if !w.IsClosed() {
		t.Fatal("window not closed after successful mint")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("nonce file still exists after mint: %v", err)
	}
}

func TestConsumeMismatchCountsAndJittersWithoutCommit(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	wrongCode := "mws_" + strings.Repeat("B", 39)
	w, path := scratchWindow(t, setupCode)
	out, _ := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: wrongCode,
		Recheck:   passthroughRecheck,
		Commit:    nilCommit,
	})
	if out != OutcomeMismatch {
		t.Fatalf("outcome = %v, want OutcomeMismatch", out)
	}
	if w.failureCount != 1 {
		t.Fatalf("failureCount = %d, want 1", w.failureCount)
	}
	if w.IsClosed() {
		t.Fatal("window closed after 1 failure")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("nonce file gone after mismatch: %v", err)
	}
}

func TestConsumeFormatErrorCountsBeforeArgon2(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, _ := scratchWindow(t, setupCode)
	out, _ := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: "not-the-right-shape",
		Recheck:   passthroughRecheck,
		Commit:    nilCommit,
	})
	if out != OutcomeFormatError {
		t.Fatalf("outcome = %v, want OutcomeFormatError", out)
	}
	if w.failureCount != 1 {
		t.Fatalf("failureCount = %d, want 1", w.failureCount)
	}
}

func TestConsumeFiveFailuresLockOutAndRemoveNonce(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	wrongCode := "mws_" + strings.Repeat("B", 39)
	w, path := scratchWindow(t, setupCode)
	for i := 0; i < MaxFailures; i++ {
		out, _ := w.Consume(context.Background(), ConsumeRequest{
			SetupCode: wrongCode,
			Recheck:   passthroughRecheck,
			Commit:    nilCommit,
		})
		_ = out
	}
	if !w.IsClosed() {
		t.Fatalf("window not closed after %d failures", MaxFailures)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("nonce file still exists after lockout: %v", err)
	}
	// 6th attempt — even correct setup-code returns OutcomeClosed.
	out, _ := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   passthroughRecheck,
		Commit:    nilCommit,
	})
	if out != OutcomeClosed {
		t.Fatalf("post-lockout outcome = %v, want OutcomeClosed", out)
	}
}

func TestConsumeRecheckFailureDoesNotCount(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, _ := scratchWindow(t, setupCode)
	out, reason := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   func(_ context.Context) (bool, error) { return false, nil },
		Commit:    nilCommit,
	})
	if out != OutcomeRecheckFailed {
		t.Fatalf("outcome = %v, want OutcomeRecheckFailed", out)
	}
	if reason != "tokens_nonempty" {
		t.Fatalf("reason = %q, want tokens_nonempty", reason)
	}
	if w.failureCount != 0 {
		t.Fatalf("failureCount = %d, want 0 (recheck must not count)", w.failureCount)
	}
	if w.IsClosed() {
		t.Fatal("window closed by non-counted recheck failure")
	}
}

func TestConsumeRecheckErrorReturnsInternal(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, _ := scratchWindow(t, setupCode)
	out, _ := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   func(_ context.Context) (bool, error) { return false, errors.New("db down") },
		Commit:    nilCommit,
	})
	if out != OutcomeInternal {
		t.Fatalf("outcome = %v, want OutcomeInternal", out)
	}
	if w.IsClosed() {
		t.Fatal("window closed by recheck error")
	}
}

func TestConsumeNonceFileMissingMidwayReportsRecheckFailed(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, path := scratchWindow(t, setupCode)
	// Delete the file before Consume; argon2 will hit, the stat
	// re-check inside Consume must catch the missing file and
	// short-circuit.
	if err := os.Remove(path); err != nil {
		t.Fatalf("remove: %v", err)
	}
	out, reason := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   passthroughRecheck,
		Commit:    nilCommit,
	})
	if out != OutcomeRecheckFailed {
		t.Fatalf("outcome = %v, want OutcomeRecheckFailed", out)
	}
	if reason != "nonce_missing" {
		t.Fatalf("reason = %q, want nonce_missing", reason)
	}
}

func TestConsumeCommitErrorLeavesWindowOpen(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, path := scratchWindow(t, setupCode)
	out, _ := w.Consume(context.Background(), ConsumeRequest{
		SetupCode: setupCode,
		Recheck:   passthroughRecheck,
		Commit:    func(_ context.Context) error { return errors.New("db locked") },
	})
	if out != OutcomeInternal {
		t.Fatalf("outcome = %v, want OutcomeInternal", out)
	}
	if w.IsClosed() {
		t.Fatal("Closed should remain false after Commit error")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("nonce file removed despite Commit failure: %v", err)
	}
}

func TestConsumeConcurrentCorrectCodesYieldOneMint(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	w, _ := scratchWindow(t, setupCode)
	// First Consume's Commit will block until Release fires so we
	// can race a second Consume against it.
	release := make(chan struct{})
	committed := make(chan struct{}, 2)
	successCount := 0
	rejected := 0
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, _ := w.Consume(context.Background(), ConsumeRequest{
				SetupCode: setupCode,
				Recheck:   passthroughRecheck,
				Commit: func(_ context.Context) error {
					committed <- struct{}{}
					<-release
					return nil
				},
			})
			mu.Lock()
			defer mu.Unlock()
			switch out {
			case OutcomeOK:
				successCount++
			case OutcomeClosed:
				rejected++
			}
		}()
	}
	// Wait for one Commit to enter; second goroutine is parked
	// behind Mu and will see Closed=true once we release.
	<-committed
	close(release)
	wg.Wait()
	if successCount != 1 {
		t.Fatalf("successCount = %d, want 1", successCount)
	}
	if rejected != 1 {
		t.Fatalf("rejected = %d, want 1 (OutcomeClosed)", rejected)
	}
}

func TestConsumeRemoveNonceFailureFlipsClosedAndLogsCritical(t *testing.T) {
	setupCode := "mws_" + strings.Repeat("A", 39)
	// Build a window whose noncePath cannot be removed (parent
	// directory deleted so os.Remove returns ENOENT — same error
	// path tests as a permission failure for our purposes).
	tmp := t.TempDir()
	path := filepath.Join(tmp, "sub", "setup_nonce.hash")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	salt := make([]byte, store.Argon2SaltLen)
	for i := range salt {
		salt[i] = byte(i + 1)
	}
	digest := argon2Hash(setupCode, salt)
	if err := setupnonce.Write(path, salt, digest); err != nil {
		t.Fatalf("Write: %v", err)
	}
	parsed, err := setupnonce.Parse(path)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	var sink strings.Builder
	logger := slog.New(slog.NewJSONHandler(&sink, nil))
	w, err := Open(parsed, path, logger)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	// Delete the parent directory so os.Remove of the file path
	// fails inside Consume (the file is gone too, so Stat will
	// fail first — covered by another test). For this assertion
	// we use the lockoutLocked branch by failing five times then
	// observing the CRITICAL log line.
	_ = os.RemoveAll(filepath.Dir(path))

	wrongCode := "mws_" + strings.Repeat("B", 39)
	for i := 0; i < MaxFailures; i++ {
		w.Consume(context.Background(), ConsumeRequest{
			SetupCode: wrongCode,
			Recheck:   passthroughRecheck,
			Commit:    nilCommit,
		})
	}
	if !w.IsClosed() {
		t.Fatal("window not closed after lockout")
	}
	if !strings.Contains(sink.String(), "CRITICAL") {
		t.Fatalf("log missing CRITICAL marker:\n%s", sink.String())
	}
}

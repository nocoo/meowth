package testbackend

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
)

// docs/features/03 §6.1 L2 row + commit #7 — test-only recorder
// for the chat L2 harness (task #21). The recorder is OFF by
// default. It activates ONLY when:
//
//   MEOWTH_TEST=1            AND
//   MEOWTH_BACKEND_FACTORY=fake
//
// The factory itself is already gated on the same envs (see
// internal/agentfactory), so production code paths physically
// cannot reach this file. The double-gate here is belt-and-
// suspenders: a future refactor that exposes testbackend.Fake
// from another factory still cannot accidentally start logging.
//
// SECURITY — STRICT FIELD WHITELIST (docs/features/03 §6.1):
//   - backend_type      (constant "fake")
//   - call_seq          (process-local monotonic uint64)
//   - resume_session_id (verbatim string; "" allowed)
//   - prompt_length     (len(prompt) — byte count, per spec)
//   - test_marker       (verbatim MEOWTH_CHAT_L2_TEST_MARKER)
//
// FORBIDDEN — must never appear in the output file:
//   - prompt body (only its byte length is recorded)
//   - Authorization / Bearer header content (recorder is below
//     the HTTP layer; bearer is physically out of reach)
//   - mwt_* / mws_* token literals
//   - setup_code
//   - opts.SystemPrompt / opts.CustomArgs / opts.McpConfig / etc.
//   - any field added later without a paired test update
//
// Path is taken from MEOWTH_CHAT_L2_RECORDER_PATH (absolute path
// supplied by the L2 harness). If unset, the recorder emits a
// single stderr warning per call and writes nothing — chosen so a
// missing test rigging is loud but never accidentally writes into
// the repo working tree.

const (
	envTest    = "MEOWTH_TEST"
	envFactory = "MEOWTH_BACKEND_FACTORY"
	envMarker  = "MEOWTH_CHAT_L2_TEST_MARKER"
	envPath    = "MEOWTH_CHAT_L2_RECORDER_PATH"
)

type execRecord struct {
	BackendType     string `json:"backend_type"`
	CallSeq         uint64 `json:"call_seq"`
	ResumeSessionID string `json:"resume_session_id"`
	PromptLength    int    `json:"prompt_length"`
	TestMarker      string `json:"test_marker"`
}

var (
	recorderCallSeq uint64
	recorderMu      sync.Mutex
)

// recorderEnabled returns true iff the recorder env gate is open.
// It is the only place callers should check; tests use the env
// directly to toggle without touching package state.
func recorderEnabled() bool {
	return os.Getenv(envTest) == "1" && os.Getenv(envFactory) == "fake"
}

// resetRecorderStateForTest re-zeroes the call_seq counter. It
// exists purely so unit tests in this package can assert against
// absolute initial values (1, 2, 3 …) without coupling to test
// order. NOT exported; calling it from production code would be
// a bug (and production cannot reach this file anyway).
func resetRecorderStateForTest() {
	recorderMu.Lock()
	defer recorderMu.Unlock()
	atomic.StoreUint64(&recorderCallSeq, 0)
}

// recordExec writes one execRecord JSON object to the file named
// by MEOWTH_CHAT_L2_RECORDER_PATH. Returns an error if the file
// path is set but the write fails — callers (Execute) should
// fail fast so the L2 harness never silently drops a record.
//
// If the path env is unset, recordExec prints a single warning to
// stderr and returns nil so the surrounding test harness is not
// broken by a missing rig, while still being noisy.
func recordExec(prompt string, resumeSessionID string) error {
	path := os.Getenv(envPath)
	if path == "" {
		// No file rigged. Bump the seq so subsequent enabled
		// calls within the same process keep increasing, then
		// warn once per call.
		atomic.AddUint64(&recorderCallSeq, 1)
		fmt.Fprintln(os.Stderr, "testbackend recorder: enabled but MEOWTH_CHAT_L2_RECORDER_PATH unset; dropping record")
		return nil
	}

	recorderMu.Lock()
	defer recorderMu.Unlock()
	seq := atomic.AddUint64(&recorderCallSeq, 1)
	rec := execRecord{
		BackendType:     "fake",
		CallSeq:         seq,
		ResumeSessionID: resumeSessionID,
		PromptLength:    len(prompt),
		TestMarker:      os.Getenv(envMarker),
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("marshal exec record: %w", err)
	}
	// The recorder path is supplied by the test harness via env
	// (MEOWTH_CHAT_L2_RECORDER_PATH); variable-path open is
	// intentional here and only reachable when the env gates are
	// open (MEOWTH_TEST=1 + MEOWTH_BACKEND_FACTORY=fake).
	// #nosec G304,G703
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open recorder file: %w", err)
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		_ = f.Close()
		return fmt.Errorf("write exec record: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close recorder file: %w", err)
	}
	return nil
}

package agent

import (
	"context"
	"log/slog"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// pi_stability_test.go holds Pi-specific stability regressions. It
// only covers Pi because the fake-binary stubs in
// `exec_fixture_unix_test.go` map cleanly onto Pi's "stream JSON to
// stdout, exit 0" execution shape — the same harness style we already
// use in pi_test.go.
//
// Other backends (claude, codex, hermes, copilot) speak ACP /
// JSON-RPC handshakes with the daemon, so a shell-script fake is
// insufficient to reach equivalent contract points. Adding stability
// coverage for those backends needs a different fixture (in-process
// fake transport or per-protocol stub binary) and is deferred — this
// file deliberately does NOT claim cross-backend coverage. See the
// session_contract_test.go counterpart for the SDK-wide guarantees
// every backend already honours.

// TestPiStability_BinaryExitsNonzeroDeliversTerminalResult covers the
// "binary refuses to start cleanly" case: a fake Pi shell that exits
// non-zero before writing any JSON. The backend goroutine must still
// publish a Result with a non-completed Status (so callers can
// distinguish a refused run from success) and the Messages / Result
// channels must close so a parked drain returns.
func TestPiStability_BinaryExitsNonzeroDeliversTerminalResult(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Write a small stderr message so the failure path also exercises
	// the stderr-tail capture in proc_other.go.
	writeTestExecutable(t, fakePath, []byte("#!/bin/sh\nprintf '%s\\n' 'pi refused to start' >&2\nexit 1\n"))

	res := runPiStability(t, fakePath, "probe")
	if res.Status == "completed" {
		t.Fatalf("non-zero exit must NOT report Status=completed; got status=%q error=%q",
			res.Status, res.Error)
	}
	if res.Status == "" {
		t.Fatal("Result.Status must be set to a non-empty terminal value when the binary fails")
	}
}

// TestPiStability_GarbageStdoutStillDeliversResult covers the
// "binary writes lines that aren't valid Pi JSON events" case.
// pi.go ignores unparseable lines, so the backend should still
// publish a Result (the exact Status depends on whether the run
// otherwise completed — we deliberately don't pin it here so this
// test isn't a thinly-disguised behavioural change). The contract
// under test is "no hang" and "Messages/Result both close".
func TestPiStability_GarbageStdoutStillDeliversResult(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"for i in 1 2 3 4 5; do printf '%s\\n' 'this is not JSON: random=$i'; done\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	res := runPiStability(t, fakePath, "probe")
	_ = res // Status assertion intentionally omitted — see godoc above.
}

// TestPiStability_CtxCancelDeliversTerminalResult covers caller-side
// cancellation: a fake Pi that sits in `sleep` forever, with the
// caller cancelling the parent ctx after a brief moment. The backend
// must terminate the child, publish a non-completed Result, and close
// both channels within the test's deadline. This is the path that
// in production lets a daemon shutdown / HTTP-client disconnect kill
// a live run without leaking goroutines.
func TestPiStability_CtxCancelDeliversTerminalResult(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Write a single agent_start so the backend's scanner has parsed
	// something before we cancel; this exercises the cancel path
	// after the event loop has started rather than during startup
	// race conditions.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"sleep 30\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("agent.New(pi): %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	session, err := backend.Execute(ctx, "probe", ExecOptions{})
	if err != nil {
		cancel()
		t.Fatalf("Execute: %v", err)
	}

	// Wait briefly for the agent_start event to land, then cancel.
	// This proves the cancel path doesn't depend on the run being in
	// any particular event state.
	select {
	case <-session.Messages:
	case <-time.After(2 * time.Second):
		// No event yet — proceed anyway; the contract is "cancel
		// delivers a terminal Result" regardless of stream state.
	}
	cancel()

	// Drain Messages so the goroutine can close down cleanly. With
	// the contract intact, the channel closes once the backend
	// notices ctx.Done and tears the child down. The 20s budget is
	// observed (~10s on local hardware for SIGKILL + cmd.Wait
	// + stderr-tail drain) plus a safety margin; the contract is
	// "cancel delivers Result", not "cancel within N ms".
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for range session.Messages {
		}
	}()
	select {
	case <-drained:
	case <-time.After(20 * time.Second):
		t.Fatal("Messages channel never closed after ctx cancel; backend goroutine likely leaked")
	}

	select {
	case res, ok := <-session.Result:
		if !ok {
			t.Fatal("Result channel closed without delivering a value on cancelled run")
		}
		if res.Status == "completed" {
			t.Fatalf("cancelled run must NOT report Status=completed; got status=%q", res.Status)
		}
		if res.Status == "" {
			t.Fatal("cancelled run must report a non-empty terminal Status")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Result not delivered within 5s of cancel; backend may have leaked goroutine")
	}
}

// TestPiStability_HighVolumeMessagesDoesNotBlockBackend covers the
// counterpart to TestTrySendDropsWhenChannelFull at the integration
// level: a fake Pi that bursts more events than the Messages
// channel's 256-slot buffer can hold, with no concurrent consumer.
// trySend's non-blocking semantic should let the backend's scanner
// keep advancing (dropping the excess), reach agent_end, write
// Result, and close both channels. Without the contract holding, the
// backend goroutine would park on a full Messages send and the test
// would time out.
//
// The test deliberately drains Messages *after* the backend has
// finished writing, to make the high-volume condition real. Reading
// concurrently would let the consumer keep pace and hide the
// regression we want to catch.
func TestPiStability_HighVolumeMessagesDoesNotBlockBackend(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// 1000 text_delta events comfortably exceeds the 256-slot buffer
	// in pi.go's msgCh while staying fast (~20ms on local hardware).
	var sb strings.Builder
	sb.WriteString("#!/bin/sh\n")
	sb.WriteString("printf '%s\\n' '{\"type\":\"agent_start\"}'\n")
	sb.WriteString("i=0\n")
	sb.WriteString("while [ $i -lt 1000 ]; do\n")
	sb.WriteString("  printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\".\"}}'\n")
	sb.WriteString("  i=$((i+1))\n")
	sb.WriteString("done\n")
	sb.WriteString("printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"m\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n")
	sb.WriteString("printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n")
	sb.WriteString("exit 0\n")
	writeTestExecutable(t, fakePath, []byte(sb.String()))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("agent.New(pi): %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	// Sleep a beat to let the fake binary saturate the channel.
	// 200ms is more than enough for 1000 lines of `printf` to land.
	time.Sleep(200 * time.Millisecond)

	// Now drain. Backend must have already written Result (because
	// trySend dropped overflow rather than blocking) and closed both
	// channels.
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for range session.Messages {
		}
	}()
	select {
	case <-drained:
	case <-time.After(10 * time.Second):
		t.Fatal("Messages channel never closed under high-volume burst; backend likely blocked on a full msgCh send")
	}

	select {
	case res, ok := <-session.Result:
		if !ok {
			t.Fatal("Result channel closed without delivering a value after high-volume burst")
		}
		if res.Status != "completed" {
			t.Fatalf("expected Status=completed on a clean burst; got status=%q error=%q",
				res.Status, res.Error)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Result not delivered after high-volume burst; backend likely deadlocked")
	}
}

// runPiStability is a small helper that constructs a Pi backend
// pointed at fakePath, runs one Execute, drains Messages, and returns
// the Result. Used by the stability tests that only care about the
// final Result.
func runPiStability(t *testing.T, fakePath, prompt string) Result {
	t.Helper()
	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("agent.New(pi): %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, prompt, ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for range session.Messages {
		}
	}()
	select {
	case <-drained:
	case <-time.After(8 * time.Second):
		t.Fatal("Messages channel never closed; backend goroutine likely leaked")
	}

	select {
	case res, ok := <-session.Result:
		if !ok {
			t.Fatal("Result channel closed without delivering a value")
		}
		return res
	case <-time.After(5 * time.Second):
		t.Fatal("Result not delivered within timeout; backend may be hung")
	}
	return Result{} // unreachable; t.Fatal exits the goroutine
}

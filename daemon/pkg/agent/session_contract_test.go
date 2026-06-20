package agent

import (
	"context"
	"log/slog"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

// session_contract_test.go locks the Session API guarantees called out
// in the agent.Session godoc. These are pure contract tests — they do
// not exercise any specific backend's protocol, they just hold the SDK
// to the lifecycle promises every backend must honour. Per-backend
// stability behaviour (terminal results from `exit 1`, garbage
// stdout, ctx cancel, large message floods) lives in the per-backend
// stability files, e.g. `pi_stability_test.go`.

// TestSessionResultChannelIsBufferedAtLeastOne pins the property that
// makes drain-then-read safe: every backend's Result channel must
// accept the final value without a reader present. If a future
// refactor accidentally makes Result an unbuffered channel, the
// backend goroutine will deadlock against any caller that drains
// Messages first.
//
// We assert this on every whitelisted agent type to catch a single
// backend regressing in isolation. The probe uses reflect.Cap rather
// than poking the backend — Session.Result is a receive-only chan, so
// the test only inspects the buffer capacity, never tries to send.
func TestSessionResultChannelIsBufferedAtLeastOne(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	for _, agentType := range SupportedTypes {
		agentType := agentType
		t.Run(agentType, func(t *testing.T) {
			t.Parallel()

			// Fake binary that prints nothing and exits 0 quickly.
			// We only need the backend to construct a Session — it's
			// fine if the run finishes by the time we inspect Result,
			// because cap() on a closed buffered channel is still its
			// declared capacity.
			fakePath := filepath.Join(t.TempDir(), agentType)
			writeTestExecutable(t, fakePath, []byte("#!/bin/sh\nexit 0\n"))

			backend, err := New(agentType, Config{ExecutablePath: fakePath, Logger: slog.Default()})
			if err != nil {
				t.Fatalf("agent.New(%q): %v", agentType, err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 2 * time.Second})
			if err != nil {
				t.Fatalf("[%s] Execute: %v", agentType, err)
			}

			capacity := reflect.ValueOf(session.Result).Cap()
			if capacity < 1 {
				t.Fatalf("[%s] Session.Result must be buffered with cap >= 1 (drain-then-read safety); got cap=%d",
					agentType, capacity)
			}

			// Drain to release backend resources cleanly.
			for range session.Messages {
			}
			<-session.Result
		})
	}
}

// TestSessionDrainMessagesThenReadResultDoesNotDeadlock is the
// behavioural counterpart to the cap assertion above: even when a
// caller deliberately reads Messages to completion before touching
// Result (the exact ordering cli-smoke uses), the call must complete
// promptly. A regression that drops Result's buffer would manifest as
// this test exceeding its bounded timeout.
func TestSessionDrainMessagesThenReadResultDoesNotDeadlock(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	// Use Pi because pi_test.go already exercises this fake-binary
	// shape and we know the happy path lands. Any whitelisted backend
	// would work for the contract; picking one keeps the test focused.
	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"hi\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"m\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("agent.New(pi): %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	// 1. Drain Messages first, in the foreground, with no parallel
	//    reader on Result. If Result were unbuffered the backend
	//    goroutine would be blocked trying to send Result and the
	//    Messages channel would never close, deadlocking this loop.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range session.Messages {
		}
	}()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("Messages channel never closed within 4s — likely backend goroutine deadlocked waiting on Result reader")
	}

	// 2. THEN read Result. This must already have a buffered value;
	//    if it doesn't, the receive will hang.
	select {
	case res, ok := <-session.Result:
		if !ok {
			t.Fatal("Result channel closed without delivering a value")
		}
		if res.Status != "completed" {
			t.Fatalf("expected Status=completed, got %q (error=%q)", res.Status, res.Error)
		}
	case <-time.After(time.Second):
		t.Fatal("Result receive blocked after Messages drained — buffered-Result contract broken")
	}
}

// TestSessionResultDeliversExactlyOneValueThenClosed locks the
// "exactly one value, then closed" promise. A second receive on
// Result must return the zero Result with ok=false, not a duplicate
// and not a hang.
func TestSessionResultDeliversExactlyOneValueThenClosed(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	writeTestExecutable(t, fakePath, []byte("#!/bin/sh\nprintf '%s\\n' '{\"type\":\"agent_start\"}'\nexit 0\n"))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("agent.New(pi): %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	for range session.Messages {
	}

	first, ok := <-session.Result
	if !ok {
		t.Fatal("first Result receive returned ok=false; expected one value before close")
	}
	_ = first // value content not under test here; the lifecycle is

	// The contract says exactly one value then close. The receive on
	// the now-closed channel must return promptly with ok=false.
	select {
	case _, ok2 := <-session.Result:
		if ok2 {
			t.Fatal("Result delivered a second value; contract is exactly one")
		}
	case <-time.After(time.Second):
		t.Fatal("second Result receive hung; channel must be closed after the single send")
	}
}

// TestTrySendDropsWhenChannelFull pins the non-blocking send semantic
// that keeps the backend goroutine from stalling on a slow Messages
// consumer. The contract is documented in claude.go:535 and the
// agent.Session godoc, but until now there was no unit test catching
// a regression to a blocking send.
//
// The flow: fill a small channel to capacity, then trySend once more.
// The second send must return immediately, leaving the channel at
// capacity and the extra event dropped. We bound the call with a
// goroutine + timer to make a hang an explicit test failure rather
// than a silent hang of the whole test binary.
func TestTrySendDropsWhenChannelFull(t *testing.T) {
	t.Parallel()
	ch := make(chan Message, 1)
	ch <- Message{Type: MessageText, Content: "first"}

	done := make(chan struct{})
	go func() {
		defer close(done)
		trySend(ch, Message{Type: MessageText, Content: "second (should be dropped)"})
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("trySend blocked on a full channel; non-blocking contract broken")
	}

	if len(ch) != 1 {
		t.Fatalf("expected channel to remain at cap (1 buffered), got len=%d", len(ch))
	}
	got := <-ch
	if got.Content != "first" {
		t.Fatalf("dropped wrong message; expected the existing one to survive, got %+v", got)
	}
}

// TestTrySendDoesNotBlockOnUnbufferedChannelWithNoReader covers the
// second failure mode the production callers depend on: an unbuffered
// channel with no goroutine parked on receive. trySend must skip the
// send via the select-default branch rather than panicking or
// blocking. This is the worst-case scenario for backend stability —
// a misconfigured consumer that never reads — and trySend has to
// degrade gracefully.
func TestTrySendDoesNotBlockOnUnbufferedChannelWithNoReader(t *testing.T) {
	t.Parallel()
	ch := make(chan Message) // unbuffered, no reader

	done := make(chan struct{})
	go func() {
		defer close(done)
		trySend(ch, Message{Type: MessageText, Content: "no one listening"})
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("trySend blocked on an unbuffered channel with no reader; non-blocking contract broken")
	}
}

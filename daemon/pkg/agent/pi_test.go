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

func TestBuildPiArgsNoToolAllowlist(t *testing.T) {
	// Extension tools registered via Pi's registerTool() must not be
	// filtered out by a hardcoded --tools allowlist. Omitting --tools
	// lets Pi use its full tool registry. See #2379.
	args := buildPiArgs("test prompt", "/tmp/session.jsonl", ExecOptions{}, slog.Default())
	for i, arg := range args {
		if arg == "--tools" {
			t.Errorf("buildPiArgs emits --tools %q; should not restrict tool registry (see #2379)", args[i+1])
		}
	}
}

func TestBuildPiArgsBasicFlags(t *testing.T) {
	args := buildPiArgs("hello world", "/tmp/s.jsonl", ExecOptions{
		Model:        "anthropic/claude-sonnet-4-20250514",
		SystemPrompt: "be helpful",
	}, slog.Default())

	joined := strings.Join(args, " ")
	for _, want := range []string{"-p", "--mode json", "--session /tmp/s.jsonl", "--provider anthropic", "--model claude-sonnet-4-20250514", "--append-system-prompt"} {
		if !strings.Contains(joined, want) {
			t.Errorf("expected %q in args, got: %v", want, args)
		}
	}

	// Prompt must be the last positional argument.
	if args[len(args)-1] != "hello world" {
		t.Errorf("prompt should be last arg, got %q", args[len(args)-1])
	}
}

func TestBuildPiArgsCustomArgsAppended(t *testing.T) {
	// Users can still restrict tools via custom_args if desired.
	args := buildPiArgs("prompt", "/tmp/s.jsonl", ExecOptions{
		CustomArgs: []string{"--tools", "read,bash"},
	}, slog.Default())

	found := false
	for i, arg := range args {
		if arg == "--tools" && i+1 < len(args) && args[i+1] == "read,bash" {
			found = true
		}
	}
	if !found {
		t.Errorf("custom --tools should pass through via custom_args, got: %v", args)
	}
}

// TestPiExecuteAttachesStdinPipe verifies that the Pi backend spawns the
// child with an explicit stdin pipe (FIFO) instead of leaving cmd.Stdin
// nil. Without an explicit pipe, Pi has been observed to block under
// systemd waiting for stdin events (#2188); attaching and immediately
// closing a pipe delivers a clean EOF on a FIFO and unblocks Pi.
//
// The probe is structural rather than behavioral: a shell script in
// place of `pi` inspects /proc/self/fd/0 and only emits a valid event
// stream if stdin is a FIFO. If the fix regresses (stdin nil → /dev/null
// char device), the fake exits non-zero and the test fails.
func TestPiExecuteAttachesStdinPipe(t *testing.T) {
	t.Parallel()
	if runtime.GOOS != "linux" {
		// /proc/self/fd/0 is Linux-specific; skipping elsewhere keeps
		// the assertion portable without losing CI coverage.
		t.Skip("stdin fd inspection relies on /proc/self/fd/0")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"kind=$(stat -c '%F' -L /proc/self/fd/0 2>/dev/null || echo unknown)\n" +
		"case \"$kind\" in\n" +
		"  fifo|*pipe*)\n" +
		"    printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"    printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"    exit 0\n" +
		"    ;;\n" +
		"esac\n" +
		"printf 'stdin was %s; expected fifo\\n' \"$kind\" >&2\n" +
		"exit 1\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	go func() {
		for range session.Messages {
		}
	}()

	select {
	case result, ok := <-session.Result:
		if !ok {
			t.Fatal("result channel closed without a value")
		}
		if result.Status != "completed" {
			t.Fatalf("expected status=completed (stdin attached as fifo), got %q (error=%q)", result.Status, result.Error)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timeout waiting for result")
	}
}

func TestStripPiToolCallMarkup(t *testing.T) {
	tests := map[string]string{
		`before call:bash{command:<|"|>cd repo/path && ls -F<|"|>}<tool_call|> after`:                           "before  after",
		`before call:read{path:<|"|>repo/path/roles/example/verify.yml<|"|>} after`:                             "before  after",
		`before response:bash{command:<|"|>multica issue comment list issue-id --all --output json<|"|>} after`: "before  after",
		`before call:bash{command:<|"|>printf '{"key":"value"}'<|"|>} after`:                                    "before  after",
		`before <|turn>model after`: "before  after",
	}
	for in, want := range tests {
		got := stripPiToolCallMarkup(in)
		if got != want {
			t.Fatalf("unexpected stripped text: %q, want %q", got, want)
		}
	}
}

func TestDrainPiTextBufferSplitToolCall(t *testing.T) {
	chunks := []string{
		"before ca",
		`ll:bash{command:<|"|>ls -R repo/path`,
		`/roles/example<|"|>}`,
		" after",
	}
	var buf strings.Builder
	var got strings.Builder
	for _, chunk := range chunks {
		got.WriteString(drainPiTextBuffer(&buf, chunk))
	}
	got.WriteString(flushPiTextBuffer(&buf))
	if got.String() != "before  after" {
		t.Fatalf("unexpected streamed text: %q", got.String())
	}
}

func TestDrainPiTextBufferSplitControlToken(t *testing.T) {
	chunks := []string{"before <|tu", "rn>model after"}
	var buf strings.Builder
	var got strings.Builder
	for _, chunk := range chunks {
		got.WriteString(drainPiTextBuffer(&buf, chunk))
	}
	got.WriteString(flushPiTextBuffer(&buf))
	if got.String() != "before  after" {
		t.Fatalf("unexpected streamed text: %q", got.String())
	}
}

func TestFlushPiTextBufferKeepsUnmatchedToolPrefixes(t *testing.T) {
	tests := []string{
		"plain response: see below",
		"plain call: see below",
		`plain call:bash{command:<|"|>unterminated`,
	}
	for _, want := range tests {
		var buf strings.Builder
		got := drainPiTextBuffer(&buf, want)
		got += flushPiTextBuffer(&buf)
		if got != want {
			t.Fatalf("unexpected flushed text: %q, want %q", got, want)
		}
	}
}

// TestPiExecuteMapsMessageEndErrorToFailed locks the SDK behaviour that
// Pi runs ending with an upstream provider error MUST surface as
// Result.Status="failed", not "completed".
//
// Pi exits 0 even when the underlying provider returned a 4xx (auth
// failure, model_not_available_for_integrator, etc.) — the error is
// carried through the JSON event stream on the assistant `message_end`
// (and mirrored on `turn_end`). Earlier the Pi backend treated those
// runs as completed because finalStatus only demoted on `error` events
// or non-zero exit, which a multi-agent review uncovered as a false-
// positive smoke pass.
//
// The fixture below is taken from a real Pi raven failure mode:
// stopReason="error" plus a populated errorMessage, no assistant text,
// agent_end with willRetry=false, child exit 0. The SDK must report
// failed with the upstream error text in Result.Error.
func TestPiExecuteMapsMessageEndErrorToFailed(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// upstreamErr is the human-readable error text we expect to surface
	// in Result.Error. It is embedded into the JSON event below; keep
	// it free of characters that would have to be escaped twice
	// (shell single-quote heredoc + JSON string literal) so the fixture
	// stays readable. The real-world Pi error contains nested quotes
	// (`"vscode-chat"`) — covered separately in
	// TestPiMessageErrorTextBranchesUnit, which exercises the helper
	// directly without going through a shell.
	const upstreamErr = `400 model_not_available_for_integrator vscode-chat`
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"content\":[],\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[],\"model\":\"raven-test\",\"stopReason\":\"error\",\"errorMessage\":\"" + upstreamErr + "\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"content\":[],\"model\":\"raven-test\",\"stopReason\":\"error\",\"errorMessage\":\"" + upstreamErr + "\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	// drain Messages so the Result channel closer fires.
	sawError := false
	for msg := range session.Messages {
		if msg.Type == MessageError && strings.Contains(msg.Content, "model_not_available_for_integrator") {
			sawError = true
		}
	}
	res, ok := <-session.Result
	if !ok {
		t.Fatal("Result channel closed without delivering a value")
	}
	if res.Status != "failed" {
		t.Fatalf("expected Status=failed for stopReason=error run, got %q (error=%q)", res.Status, res.Error)
	}
	if !strings.Contains(res.Error, "model_not_available_for_integrator") {
		t.Fatalf("expected upstream error text in Result.Error, got %q", res.Error)
	}
	if !sawError {
		t.Fatal("expected a MessageError carrying the upstream error to be streamed before Result")
	}
}

// TestPiExecuteMapsStopReasonErrorWithoutErrorMessage covers the second
// branch of piMessageErrorText: Pi has been observed to emit
// stopReason="error" with no populated errorMessage (e.g. when the
// embedded provider response could not be decoded). The SDK must still
// surface this as failed rather than a silent completed run.
func TestPiExecuteMapsStopReasonErrorWithoutErrorMessage(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"stopReason\":\"error\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	for range session.Messages {
	}
	res, ok := <-session.Result
	if !ok {
		t.Fatal("Result channel closed without delivering a value")
	}
	if res.Status != "failed" {
		t.Fatalf("expected Status=failed for bare stopReason=error, got %q", res.Status)
	}
	if res.Error == "" {
		t.Fatal("expected Result.Error to carry a synthetic message when errorMessage is absent")
	}
}

// TestPiExecuteCompletedHappyPathStillPasses guards against an
// over-eager error-mapping change demoting a clean run. A normal Pi
// stream (text_delta → turn_end with usage, no stopReason="error", no
// errorMessage) must still arrive as Status=completed with the streamed
// text in Result.Output.
func TestPiExecuteCompletedHappyPathStillPasses(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"4\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":3,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":4}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	for range session.Messages {
	}
	res, ok := <-session.Result
	if !ok {
		t.Fatal("Result channel closed without delivering a value")
	}
	if res.Status != "completed" {
		t.Fatalf("expected Status=completed for clean run, got %q (error=%q)", res.Status, res.Error)
	}
	if strings.TrimSpace(res.Output) != "4" {
		t.Fatalf("expected Result.Output=\"4\", got %q", res.Output)
	}
	if res.Error != "" {
		t.Fatalf("expected empty Result.Error on completed run, got %q", res.Error)
	}
}

// TestPiMessageErrorTextBranchesUnit pins the helper used by the
// message_end/turn_end cases. Keeping it as a tiny unit test lets a
// future change adjust event handling without re-running shell-script
// fixtures to assert the policy.
func TestPiMessageErrorTextBranchesUnit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   *piMessage
		want string // "" means no error
	}{
		{"nil message", nil, ""},
		{"empty message", &piMessage{}, ""},
		{"completed turn (no stopReason)", &piMessage{Model: "m"}, ""},
		{"empty errorMessage, end stopReason", &piMessage{StopReason: "end"}, ""},
		{"populated errorMessage wins",
			&piMessage{ErrorMessage: "400 boom", StopReason: "error"}, "400 boom"},
		{"stopReason=error with whitespace errorMessage falls through",
			&piMessage{ErrorMessage: "   ", StopReason: "error"},
			"pi reported stopReason=error with no errorMessage payload"},
		{"stopReason error case-insensitive",
			&piMessage{StopReason: "Error"},
			"pi reported stopReason=error with no errorMessage payload"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := piMessageErrorText(tc.in)
			if got != tc.want {
				t.Fatalf("piMessageErrorText(%+v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

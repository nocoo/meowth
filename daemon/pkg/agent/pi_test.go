package agent

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"os"
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
	args := buildPiArgs("/tmp/session.jsonl", "", ExecOptions{}, slog.Default())
	for i, arg := range args {
		if arg == "--tools" {
			t.Errorf("buildPiArgs emits --tools %q; should not restrict tool registry (see #2379)", args[i+1])
		}
	}
}

func TestBuildPiArgsBasicFlags(t *testing.T) {
	args := buildPiArgs("/tmp/s.jsonl", "/tmp/sysprompt.txt", ExecOptions{
		Model: "anthropic/claude-sonnet-4-20250514",
	}, slog.Default())

	joined := strings.Join(args, " ")
	for _, want := range []string{"-p", "--mode json", "--session /tmp/s.jsonl", "--provider anthropic", "--model claude-sonnet-4-20250514", "--append-system-prompt /tmp/sysprompt.txt"} {
		if !strings.Contains(joined, want) {
			t.Errorf("expected %q in args, got: %v", want, args)
		}
	}

	// Prompt must NOT be in argv.
	for _, arg := range args {
		if arg == "hello world" {
			t.Errorf("prompt should not be passed in argv, got %v", args)
		}
	}
}

func TestBuildPiArgsCustomArgsAppended(t *testing.T) {
	// Users can still restrict tools via custom_args if desired.
	args := buildPiArgs("/tmp/s.jsonl", "", ExecOptions{
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

func TestPiExecuteLargePromptViaStdinAndSystemPromptTempFile(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// The fake Pi child:
	// 1. Reads stdin until EOF and computes its SHA256.
	// 2. Checks argv for --append-system-prompt <file>, reads the file and computes its SHA256.
	// 3. Emits valid agent events and prints both SHA256 hashes in text_delta.
	script := "#!/bin/sh\n" +
		"stdin_hash=$(cat | shasum -a 256 | awk '{print $1}')\n" +
		"sys_path=''\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"--append-system-prompt\" ]; then\n" +
		"    sys_path=\"$2\"\n" +
		"    shift 2\n" +
		"  else\n" +
		"    shift\n" +
		"  fi\n" +
		"done\n" +
		"sys_hash=''\n" +
		"if [ -n \"$sys_path\" ] && [ -f \"$sys_path\" ]; then\n" +
		"  sys_hash=$(shasum -a 256 \"$sys_path\" | awk '{print $1}')\n" +
		"fi\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"stdin:'\"$stdin_hash\"';sys:'\"$sys_hash\"'\"}}\\n'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	// 2 MiB prompt (> 1 MiB previous body limit and > POSIX ARG_MAX)
	largePrompt := strings.Repeat("hello 中文测试 multi-byte unicode 1234567890\n", 40000)
	largeSystemPrompt := strings.Repeat("system instructions line \n", 10000)

	expectedPromptHash := fmt.Sprintf("%x", sha256Sum([]byte(largePrompt)))
	expectedSysHash := fmt.Sprintf("%x", sha256Sum([]byte(largeSystemPrompt)))

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, largePrompt, ExecOptions{
		SystemPrompt: largeSystemPrompt,
		Timeout:      10 * time.Second,
	})
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
		t.Fatalf("expected Status=completed, got %q (error=%q)", res.Status, res.Error)
	}

	expectedOutput := fmt.Sprintf("stdin:%s;sys:%s", expectedPromptHash, expectedSysHash)
	if res.Output != expectedOutput {
		t.Fatalf("output mismatch: got %q want %q", res.Output, expectedOutput)
	}
}

func TestPiExecuteEmptyPromptDeliversEOFAndCleansTempFile(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// The fake Pi child:
	// 1. Reads stdin until EOF; empty input gives 0 bytes.
	// 2. Checks sys_path existence and readability.
	script := "#!/bin/sh\n" +
		"stdin_bytes=$(wc -c | tr -d ' ')\n" +
		"sys_path=''\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"--append-system-prompt\" ]; then\n" +
		"    sys_path=\"$2\"\n" +
		"    shift 2\n" +
		"  else\n" +
		"    shift\n" +
		"  fi\n" +
		"done\n" +
		"if [ -n \"$sys_path\" ] && [ ! -f \"$sys_path\" ]; then\n" +
		"  exit 2\n" +
		"fi\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"bytes:'\"$stdin_bytes\"';path:'\"$sys_path\"'\"}}\\n'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "", ExecOptions{
		SystemPrompt: "test system prompt",
		Timeout:      5 * time.Second,
	})
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
		t.Fatalf("expected Status=completed, got %q (error=%q)", res.Status, res.Error)
	}

	// Output contains bytes:0;path:/...
	if !strings.HasPrefix(res.Output, "bytes:0;path:") {
		t.Fatalf("unexpected output: %q", res.Output)
	}

	parts := strings.Split(res.Output, ";path:")
	if len(parts) == 2 {
		sysPath := parts[1]
		// Verify temporary file was cleaned up upon termination
		if _, err := os.Stat(sysPath); !os.IsNotExist(err) {
			t.Fatalf("temp system prompt file %q was not removed after execution", sysPath)
		}
	}
}

// TestPiExecuteCleansTempFileAndExitsWhenChildIgnoresStdinAndCancelled proves
// that when a child process never reads stdin and caller cancels context,
// the run terminates cleanly without deadlock and the temp system prompt is removed.
func TestPiExecuteCleansTempFileAndExitsWhenChildIgnoresStdinAndCancelled(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// The fake Pi child:
	// 1. Intentionally never touches stdin.
	// 2. Extracts sys_path and outputs it.
	// 3. Sleeps indefinitely until killed by context cancellation.
	script := "#!/bin/sh\n" +
		"sys_path=''\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"--append-system-prompt\" ]; then\n" +
		"    sys_path=\"$2\"\n" +
		"    shift 2\n" +
		"  else\n" +
		"    shift\n" +
		"  fi\n" +
		"done\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"sys:'\"$sys_path\"'\"}}\\n'\n" +
		"sleep 60\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	// 1 MiB prompt that child ignores; os/exec writer goroutine will be blocked
	// on writing until child dies.
	largePrompt := strings.Repeat("unconsumed prompt text\n", 40000)

	ctx, cancel := context.WithCancel(context.Background())
	session, err := backend.Execute(ctx, largePrompt, ExecOptions{
		SystemPrompt: "confidential system instructions",
		Timeout:      10 * time.Second,
	})
	if err != nil {
		cancel()
		t.Fatalf("execute: %v", err)
	}

	gotSysPath := make(chan string, 1)
	go func() {
		var collected strings.Builder
		for msg := range session.Messages {
			if msg.Type == MessageText {
				collected.WriteString(msg.Content)
				if strings.Contains(collected.String(), "sys:") {
					str := collected.String()
					idx := strings.Index(str, "sys:")
					path := strings.TrimSpace(str[idx+4:])
					if path != "" {
						select {
						case gotSysPath <- path:
						default:
						}
					}
				}
			}
		}
	}()

	var sysPath string
	select {
	case sysPath = <-gotSysPath:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for sys: path message")
	}

	// Cancel context while child is blocked in sleep and writer is blocked on pipe.
	cancel()

	select {
	case res, ok := <-session.Result:
		if !ok {
			t.Fatal("result channel closed without value")
		}
		if res.Status != "aborted" {
			t.Fatalf("expected status=aborted, got %q", res.Status)
		}
		if _, err := os.Stat(sysPath); !os.IsNotExist(err) {
			t.Fatalf("temporary system prompt file %q was not removed after cancellation", sysPath)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("backend deadlocked or failed to terminate upon context cancellation within WaitDelay")
	}
}

// TestPiExecuteHandlesMassiveStdoutLineWithoutScannerLimit proves that
// reader.ReadBytes('\n') handles a stdout JSON line larger than the old
// bufio.Scanner 32MiB limit without truncating or failing, followed by a sentinel line.
func TestPiExecuteHandlesMassiveStdoutLineWithoutScannerLimit(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// The fake Pi child:
	// Emits agent_start, then a 34 MiB text_delta line, then a turn_end sentinel.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"'\n" +
		"awk 'BEGIN { for (i=0; i<1060000; i++) printf \"01234567890123456789012345678901\" }'\n" +
		"printf '\"}}\\n'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 15 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	for range session.Messages {
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "completed" {
		t.Fatalf("expected status=completed, got %q (error=%q)", res.Status, res.Error)
	}
	if len(res.Output) < 33000000 {
		t.Fatalf("expected output length >= 33MB, got %d bytes", len(res.Output))
	}
}

// TestPiExecuteCleansTempFileOnStartFailure proves that when cmd.Start fails
// (e.g. invalid working directory), the temporary system prompt file is immediately cleaned up.
func TestPiExecuteCleansTempFileOnStartFailure(t *testing.T) {
	t.Parallel()

	fakePath := filepath.Join(t.TempDir(), "pi")
	writeTestExecutable(t, fakePath, []byte("#!/bin/sh\nexit 0\n"))
	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx := context.Background()
	nonExistentDir := filepath.Join(t.TempDir(), "does-not-exist-cwd")
	_, err = backend.Execute(ctx, "probe", ExecOptions{
		Cwd:          nonExistentDir,
		SystemPrompt: "confidential instructions start failure",
	})
	if err == nil {
		t.Fatal("expected execute to fail for non-existent working directory")
	}

	// Verify no orphaned meowth-pi-sysprompt files left behind matching our run.
	pattern := filepath.Join(os.TempDir(), "meowth-pi-sysprompt-*.txt")
	matches, _ := filepath.Glob(pattern)
	for _, m := range matches {
		info, statErr := os.Stat(m)
		if statErr == nil && time.Since(info.ModTime()) < 10*time.Second {
			content, _ := os.ReadFile(m)
			if string(content) == "confidential instructions start failure" {
				t.Fatalf("orphaned system prompt file found after Start failure: %s", m)
			}
		}
	}
}

// TestPiSystemPromptFilePermissionsAndAbsolutePath proves that the temporary
// system prompt file is created with 0600 mode and passed as an absolute path.
func TestPiSystemPromptFilePermissionsAndAbsolutePath(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"sys_path=''\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"--append-system-prompt\" ]; then\n" +
		"    sys_path=\"$2\"\n" +
		"    shift 2\n" +
		"  else\n" +
		"    shift\n" +
		"  fi\n" +
		"done\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"path:'\"$sys_path\"'\"}}\\n'\n" +
		"sleep 1\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{
		SystemPrompt: "test system prompt",
		Timeout:      5 * time.Second,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	var capturedPath string
	for msg := range session.Messages {
		if msg.Type == MessageText && strings.HasPrefix(msg.Content, "path:") {
			capturedPath = strings.TrimPrefix(msg.Content, "path:")
			// Assert file permissions while child is still alive
			fi, err := os.Stat(capturedPath)
			if err != nil {
				t.Fatalf("stat system prompt file: %v", err)
			}
			if perm := fi.Mode().Perm(); perm != 0600 {
				t.Fatalf("expected permissions 0600, got %04o", perm)
			}
			if !filepath.IsAbs(capturedPath) {
				t.Fatalf("expected absolute path, got %q", capturedPath)
			}
		}
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "completed" {
		t.Fatalf("expected status=completed, got %q (error=%q)", res.Status, res.Error)
	}
	if capturedPath == "" {
		t.Fatal("never captured system prompt path from child output")
	}
	// Verify cleaned up after execution
	if _, err := os.Stat(capturedPath); !os.IsNotExist(err) {
		t.Fatalf("temporary system prompt file %q was not removed after execution", capturedPath)
	}
}

// TestPiExecuteTimeoutCleansTempFile proves that when execution times out,
// the temporary system prompt file is cleaned up.
func TestPiExecuteTimeoutCleansTempFile(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"sys_path=''\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"--append-system-prompt\" ]; then\n" +
		"    sys_path=\"$2\"\n" +
		"    shift 2\n" +
		"  else\n" +
		"    shift\n" +
		"  fi\n" +
		"done\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"path:'\"$sys_path\"'\"}}\\n'\n" +
		"sleep 10\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx := context.Background()
	session, err := backend.Execute(ctx, "probe", ExecOptions{
		SystemPrompt: "timeout test system prompt",
		Timeout:      2 * time.Second,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	gotPath := make(chan string, 1)
	go func() {
		for msg := range session.Messages {
			if msg.Type == MessageText && strings.HasPrefix(msg.Content, "path:") {
				select {
				case gotPath <- strings.TrimPrefix(msg.Content, "path:"):
				default:
				}
			}
		}
	}()

	var capturedPath string
	select {
	case capturedPath = <-gotPath:
	case <-time.After(3 * time.Second):
		t.Fatal("never captured system prompt path from child output within deadline")
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "timeout" {
		t.Fatalf("expected status=timeout, got %q", res.Status)
	}
	if _, err := os.Stat(capturedPath); !os.IsNotExist(err) {
		t.Fatalf("temporary system prompt file %q was not removed after timeout", capturedPath)
	}
}

// TestPiExecuteHandlesTrailingPartialLineAtEOF proves that if the stdout
// stream ends with bytes not followed by a newline, it is still processed
// or drained without crashing or hanging.
func TestPiExecuteHandlesTrailingPartialLineAtEOF(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// The fake Pi child:
	// Emits a valid agent_start, then turn_end without trailing newline, then terminates.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	for range session.Messages {
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "completed" {
		t.Fatalf("expected status=completed, got %q (error=%q)", res.Status, res.Error)
	}
}

func sha256Sum(data []byte) [32]byte {
	return sha256.Sum256(data)
}

package agent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/nocoo/meowth/daemon/internal/envelope"
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
		"    printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"test\",\"stopReason\":\"stop\"}}'\n" +
		"    printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
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
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 10 * time.Second})
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
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":3,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":4}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, err := backend.Execute(ctx, "prompt-ignored", ExecOptions{Timeout: 10 * time.Second})
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
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
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
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "", ExecOptions{
		SystemPrompt: "test system prompt",
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
	// 2. Extracts sys_path and outputs it via thinking_delta so it's streamed immediately.
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
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"thinking_delta\",\"delta\":\"sys:'\"$sys_path\"'\"}}\\n'\n" +
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
			if msg.Type == MessageThinking {
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
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
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
			// #nosec G304 -- test-only fixed-prefix glob under os.TempDir().
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
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"thinking_delta\",\"delta\":\"path:'\"$sys_path\"'\"}}\\n'\n" +
		"sleep 1\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{
		SystemPrompt: "test system prompt",
		Timeout:      10 * time.Second,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	var capturedPath string
	for msg := range session.Messages {
		if msg.Type == MessageThinking && strings.HasPrefix(msg.Content, "path:") {
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
// Deliberately serial (no t.Parallel()) to prevent sub-second scheduling
// jitter under heavy CPU-bound test suites from stealing the 2s timeout window.
func TestPiExecuteTimeoutCleansTempFile(t *testing.T) {
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
		"printf '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"thinking_delta\",\"delta\":\"path:'\"$sys_path\"'\"}}\\n'\n" +
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
			if msg.Type == MessageThinking && strings.HasPrefix(msg.Content, "path:") {
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
	case <-time.After(10 * time.Second):
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
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":2}}}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 10 * time.Second})
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

func TestPiExecuteAutoRetrySuccessIsolatesAttemptText(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	tempDir := t.TempDir()
	fakePath := filepath.Join(tempDir, "pi")
	jsonlPath := filepath.Join(tempDir, "stream.jsonl")

	// #nosec G304 -- fixed fixture filename under t.TempDir().
	f, err := os.Create(jsonlPath)
	if err != nil {
		t.Fatalf("create stream.jsonl: %v", err)
	}
	enc := json.NewEncoder(f)
	_ = enc.Encode(map[string]any{"type": "agent_start"})
	_ = enc.Encode(map[string]any{"type": "turn_start"})
	_ = enc.Encode(map[string]any{
		"type":    "message_start",
		"message": map[string]any{"role": "assistant", "model": "raven-test"},
	})
	// Delta with both regular corrupt text and sanitizer markup residue (e.g. unfinished <|turn> prefix)
	_ = enc.Encode(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": `{"corrupted": "partial", <|turn`,
		},
	})
	_ = enc.Encode(map[string]any{
		"type": "message_end",
		"message": map[string]any{
			"role":         "assistant",
			"model":        "raven-test",
			"stopReason":   "error",
			"errorMessage": "500: socket closed",
		},
	})
	_ = enc.Encode(map[string]any{
		"type":        "auto_retry_start",
		"attempt":     1,
		"maxAttempts": 3,
		"delayMs":     50,
	})
	_ = enc.Encode(map[string]any{
		"type":    "message_start",
		"message": map[string]any{"role": "assistant", "model": "raven-test"},
	})
	_ = enc.Encode(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": `{"clean": true}`,
		},
	})
	_ = enc.Encode(map[string]any{
		"type": "message_end",
		"message": map[string]any{
			"role":       "assistant",
			"model":      "raven-test",
			"stopReason": "stop",
		},
	})
	_ = enc.Encode(map[string]any{
		"type":    "auto_retry_end",
		"success": true,
	})
	_ = enc.Encode(map[string]any{
		"type": "turn_end",
		"message": map[string]any{
			"role":       "assistant",
			"model":      "raven-test",
			"stopReason": "stop",
			"usage":      map[string]any{"input": 10, "output": 5, "totalTokens": 15},
		},
	})
	_ = enc.Encode(map[string]any{
		"type":      "agent_end",
		"willRetry": false,
	})
	_ = f.Close()

	script := "#!/bin/sh\n" +
		"cat \"" + jsonlPath + "\"\n" +
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

	var textMessages []string
	var statuses []string
	var sawErrorMsg bool
	for msg := range session.Messages {
		if msg.Type == MessageText {
			textMessages = append(textMessages, msg.Content)
		}
		if msg.Type == MessageStatus {
			statuses = append(statuses, msg.Status)
		}
		if msg.Type == MessageError {
			sawErrorMsg = true
		}
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "completed" {
		t.Fatalf("expected status=completed, got %q (error=%q)", res.Status, res.Error)
	}
	if sawErrorMsg {
		t.Fatal("expected no MessageError to be emitted during recoverable auto-retry")
	}
	// Verify failed attempt text was completely discarded and not prepended to clean text
	if res.Output != `{"clean": true}` {
		t.Fatalf("expected output %q, got %q", `{"clean": true}`, res.Output)
	}
	if len(textMessages) != 1 || textMessages[0] != `{"clean": true}` {
		t.Fatalf("expected exactly one text message with clean content, got %#v", textMessages)
	}
	// Verify non-sensitive status was emitted
	hasRetrying := false
	for _, s := range statuses {
		if s == "retrying" {
			hasRetrying = true
		}
	}
	if !hasRetrying {
		t.Fatalf("expected status 'retrying' in stream, got %#v", statuses)
	}
}

func TestPiExecuteAutoRetryExhaustedFailsRun(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"error\",\"errorMessage\":\"500: connection lost\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"auto_retry_end\",\"success\":false,\"finalError\":\"500: connection lost\"}'\n" +
		"printf '%s\\n' '{\"type\":\"agent_end\",\"willRetry\":false}'\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	var sawErrorMsg bool
	for msg := range session.Messages {
		if msg.Type == MessageError && strings.Contains(msg.Content, "connection lost") {
			sawErrorMsg = true
		}
	}

	res, ok := <-session.Result
	if !ok {
		t.Fatal("result channel closed without value")
	}
	if res.Status != "failed" {
		t.Fatalf("expected status=failed, got %q", res.Status)
	}
	if !strings.Contains(res.Error, "connection lost") {
		t.Fatalf("expected error to contain 'connection lost', got %q", res.Error)
	}
	if !sawErrorMsg {
		t.Fatal("expected MessageError in stream before Result")
	}
}

func TestPiExecuteNewAssistantTurnInFlightFailsIfUnfinished(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Sequence:
	// Turn 1 succeeds cleanly.
	// Turn 2 starts (new assistant message_start), but stream ends abruptly without message_end.
	// Overall run must NOT be marked completed even though Turn 1 was successful.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"turn1\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"turn2 in flight\"}}'\n" +
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
	if res.Status != "failed" {
		t.Fatalf("expected status=failed when turn 2 left in flight, got %q", res.Status)
	}
}

func TestPiExecuteNonZeroExitOverridesSuccessfulTurn(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Emits clean turn, but child process exits 42
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"ok\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"exit 42\n"
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
	if res.Status != "failed" {
		t.Fatalf("expected status=failed on non-zero exit, got %q", res.Status)
	}
}

func TestPiExecuteFatalErrorEventOverridesSubsequentEvents(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Emits top-level error event, then tries to emit a fake message_end stop. Fatal error must win.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"error\",\"message\":\"fatal CLI panic\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
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
	if res.Status != "failed" {
		t.Fatalf("expected status=failed, got %q", res.Status)
	}
	if !strings.Contains(res.Error, "fatal CLI panic") {
		t.Fatalf("expected fatal error text, got %q", res.Error)
	}
}

// TestPiExecuteChunksOutputToAvoidEnvelopeLineLimit verifies that when Pi outputs
// a very large text (> 256 KiB, e.g. 1.5 MiB), the daemon adapter delivers it in
// UTF-8 safe chunks (<= 64 KiB) so that encoding into the real daemon envelope
// (envelope.Builder -> EncodeLine -> TruncateMessageContent) yields valid wire lines
// < 524,288 bytes (Teams Native MeowthStreamDecoder.maximumLineBytes) without truncation,
// while preserving exact multibyte Unicode, quotes, and \u0001 control characters.
func TestPiExecuteChunksOutputToAvoidEnvelopeLineLimit(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	tempDir := t.TempDir()
	fakePath := filepath.Join(tempDir, "pi")
	jsonlPath := filepath.Join(tempDir, "stream.jsonl")

	// Construct expected text with repetition of Chinese multibyte runes, quotes, and \u0001 control char
	unit := "测试Unicode\"引号\"\u0001control\n"
	expectedText := strings.Repeat(unit, 45000) // ~1.5 MiB

	// Generate JSONL stream in Go using json.Marshal to guarantee zero bash escaping bugs
	// #nosec G304 -- fixed fixture filename under t.TempDir().
	f, err := os.Create(jsonlPath)
	if err != nil {
		t.Fatalf("create stream.jsonl: %v", err)
	}
	enc := json.NewEncoder(f)
	_ = enc.Encode(map[string]any{"type": "agent_start"})
	_ = enc.Encode(map[string]any{
		"type":    "message_start",
		"message": map[string]any{"role": "assistant", "model": "raven-test"},
	})
	_ = enc.Encode(map[string]any{
		"type": "message_update",
		"assistantMessageEvent": map[string]any{
			"type":  "text_delta",
			"delta": expectedText,
		},
	})
	_ = enc.Encode(map[string]any{
		"type": "message_end",
		"message": map[string]any{
			"role":       "assistant",
			"model":      "raven-test",
			"stopReason": "stop",
		},
	})
	_ = enc.Encode(map[string]any{
		"type": "turn_end",
		"message": map[string]any{
			"role":       "assistant",
			"model":      "raven-test",
			"stopReason": "stop",
			"usage":      map[string]any{"input": 10, "output": 10, "totalTokens": 20},
		},
	})
	_ = f.Close()

	// Fake child simply cats the prepared valid JSONL stream
	script := "#!/bin/sh\n" +
		"cat \"" + jsonlPath + "\"\n" +
		"exit 0\n"
	writeTestExecutable(t, fakePath, []byte(script))

	backend, err := New("pi", Config{ExecutablePath: fakePath, Logger: slog.Default()})
	if err != nil {
		t.Fatalf("new pi backend: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	session, err := backend.Execute(ctx, "probe", ExecOptions{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	builder := envelope.NewBuilder("test-session")
	now := time.Now().UTC()

	var chunks []string
	for msg := range session.Messages {
		if msg.Type == MessageText {
			chunks = append(chunks, msg.Content)
			// Each chunk must be <= 64 KiB
			if len(msg.Content) > 64*1024 {
				t.Fatalf("chunk byte length %d exceeded 64 KiB limit", len(msg.Content))
			}

			// Construct real daemon envelope using internal/envelope
			env, err := builder.Message(now, envelope.MessagePayload{
				Kind:    string(msg.Type),
				Content: msg.Content,
			})
			if err != nil {
				t.Fatalf("builder.Message: %v", err)
			}

			// Verify that TruncateMessageContent reports no truncation needed
			_, _, truncated, err := envelope.TruncateMessageContent(env)
			if err != nil {
				t.Fatalf("TruncateMessageContent: %v", err)
			}
			if truncated {
				t.Fatalf("envelope was unexpectedly truncated; chunk size is too large")
			}

			// Encode envelope line and assert wire line length < 524,288 bytes
			line, err := envelope.EncodeLine(env)
			if err != nil {
				t.Fatalf("envelope.EncodeLine: %v", err)
			}
			if len(line) >= 524288 {
				t.Fatalf("encoded envelope line length %d >= 524,288 bytes (Teams Native MeowthStreamDecoder.maximumLineBytes)", len(line))
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

	// Verify chunks reconstruct exact output without any corruption
	reconstructed := strings.Join(chunks, "")
	if reconstructed != expectedText {
		t.Fatalf("reconstructed output mismatch from expectedText: chunked len=%d, expected len=%d", len(reconstructed), len(expectedText))
	}
	if res.Output != expectedText {
		t.Fatalf("Result.Output mismatch from expectedText: res.Output len=%d, expected len=%d", len(res.Output), len(expectedText))
	}
}

// TestPiExecuteTurnEndDoesNotDuplicateUsageAcrossRetries verifies that when multiple
// assistant attempts happen in a run, usage is only counted once per assistant message lifecycle.
func TestPiExecuteTurnEndDoesNotDuplicateUsageAcrossRetries(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Turn 1 fails with 500 error; turn_end emitted with usage 10 tokens.
	// Auto retry starts.
	// Turn 2 succeeds; turn_end emitted with usage 25 tokens.
	// Total tokens should be 10 + 25 = 35. Duplicate turn_end within same attempt must not double count.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"error\",\"errorMessage\":\"500\",\"usage\":{\"input\":8,\"output\":2,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":10}}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"error\",\"errorMessage\":\"500\",\"usage\":{\"input\":8,\"output\":2,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":10}}}'\n" +
		"printf '%s\\n' '{\"type\":\"auto_retry_start\",\"attempt\":1,\"maxAttempts\":3,\"delayMs\":10}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":20,\"output\":5,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":25}}}'\n" +
		"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"stop\",\"usage\":{\"input\":20,\"output\":5,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":25}}}'\n" +
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
	usage := res.Usage["raven-test"]
	// Should be 8+20=28 input, 2+5=7 output. Duplicates must have been suppressed.
	if usage.InputTokens != 28 || usage.OutputTokens != 7 {
		t.Fatalf("expected usage input=28, output=7; got input=%d, output=%d",
			usage.InputTokens, usage.OutputTokens)
	}
}

// TestPiExecuteAutoRetryEndSuccessCannotClearNonSuccessStopReasons verifies that
// an auto_retry_end(success=true) event does not clear aborted, length, or missing stopReasons.
func TestPiExecuteAutoRetryEndSuccessCannotClearNonSuccessStopReasons(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	cases := []struct {
		name       string
		stopReason string
	}{
		{"aborted", "aborted"},
		{"length", "length"},
		{"empty", ""},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fakePath := filepath.Join(t.TempDir(), "pi")
			stopReasonJSON := ""
			if tc.stopReason != "" {
				stopReasonJSON = `,"stopReason":"` + tc.stopReason + `"`
			}
			script := "#!/bin/sh\n" +
				"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
				"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
				"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"" + stopReasonJSON + "}}'\n" +
				"printf '%s\\n' '{\"type\":\"auto_retry_end\",\"success\":true}'\n" +
				"printf '%s\\n' '{\"type\":\"turn_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"" + stopReasonJSON + ",\"usage\":{\"input\":5,\"output\":1,\"totalTokens\":6}}}'\n" +
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
			if res.Status != "failed" {
				t.Fatalf("expected status=failed when stopReason=%q even with auto_retry_end(success=true), got %q", tc.stopReason, res.Status)
			}
		})
	}
}

// TestPiExecuteMessageEndUsagePreservedOnMidToolFailure verifies that when an assistant
// message_end provides usage before a tool call, and the child fails during tool execution
// (nonzero exit without ever emitting turn_end), the recorded usage is preserved on the failed Result.
func TestPiExecuteMessageEndUsagePreservedOnMidToolFailure(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake binary requires a POSIX shell")
	}

	fakePath := filepath.Join(t.TempDir(), "pi")
	// Sequence:
	// 1. Assistant message_start & message_end with stopReason "toolUse" and populated usage.
	// 2. tool_execution_start emitted.
	// 3. Child exits non-zero (42) without ever emitting turn_end.
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"type\":\"agent_start\"}'\n" +
		"printf '%s\\n' '{\"type\":\"message_start\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"model\":\"raven-test\",\"stopReason\":\"toolUse\",\"usage\":{\"input\":12,\"output\":4,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":16}}}'\n" +
		"printf '%s\\n' '{\"type\":\"tool_execution_start\",\"toolName\":\"bash\",\"toolCallId\":\"call-1\"}'\n" +
		"exit 42\n"
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
	if res.Status != "failed" {
		t.Fatalf("expected status=failed on non-zero exit during tool, got %q", res.Status)
	}
	usage, exists := res.Usage["raven-test"]
	if !exists {
		t.Fatal("expected usage for raven-test to be recorded from message_end before tool failure")
	}
	if usage.InputTokens != 12 || usage.OutputTokens != 4 {
		t.Fatalf("expected usage input=12, output=4; got input=%d, output=%d", usage.InputTokens, usage.OutputTokens)
	}
}

func sha256Sum(data []byte) [32]byte {
	return sha256.Sum256(data)
}

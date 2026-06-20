// Package clismoke is the opt-in real-CLI smoke test for the trimmed
// agent SDK. It exercises the four required real-smoke backends
// (claude / codex / hermes / pi) against the actual local CLI binary
// to prove the vendored-and-trimmed SDK still drives the upstream
// tools end-to-end. Copilot is the fifth whitelisted backend in the
// SDK (see docs/architecture/01 §4) but is intentionally outside this
// suite at zheng-li's direction; its real e2e is deferred to the
// dashboard integration phase.
//
// This suite is gated by `MEOWTH_CLI_SMOKE=1`. Default `go test ./...`
// skips the whole `TestCLISmoke` so CI stays green on machines without
// the CLIs installed. See docs/architecture/08-6dq-hooks-wiring.md §10
// and docs/architecture/01-agent-sdk-pump-from-multica.md §8.
//
// Why an opt-in env instead of a build tag:
//   - the SDK + build artifacts are identical between "smoke on" and
//     "smoke off"; a build tag would fork the binary
//   - the same env-gate convention is reused for the SQLite test store
//     (see docs/architecture/03 §9.1), so contributors only need to
//     remember one signal for test-mode behaviour
//
// When the env IS set, a missing CLI for any of the four required
// backends fails the parent test. We do not silently treat
// "no CLI installed" as a partial pass because that turns the
// real-CLI proof into a no-op on machines that lack the binaries.
// Allowing missing CLIs as a deliberate partial-smoke mode would
// need its own explicit env (e.g. MEOWTH_CLI_SMOKE_ALLOW_MISSING=1);
// no such mode is wired today.
package clismoke

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

const (
	smokeEnvVar = "MEOWTH_CLI_SMOKE"
	// perTestTimeout caps each backend's end-to-end run. 120s covers
	// the slowest observed cold-start path on this machine: hermes'
	// ACP adapter loads every configured MCP server (`~/.hermes/`
	// MCP registry) before responding to `initialize`, which on a host
	// with several MCP entries (including ones that retry on network
	// failure) regularly takes 25–35s before the SDK sees its first
	// response. claude / codex / pi all complete in <10s; the cap is
	// set by hermes' upstream startup behaviour, not by SDK overhead.
	perTestTimeout = 120 * time.Second
	// minimalPrompt is intentionally trivial so the assertion focuses on
	// "did the SDK drive the backend through to a completed result?" rather
	// than the model's correctness. A 1–2 token answer keeps wall-clock
	// short and avoids tripping content-filter heuristics on any backend.
	minimalPrompt = "What is 2+2? Just answer with a number."
	// tailMessages bounds how much of the per-backend transcript we dump
	// on failure. The full stream is captured up to this many tail entries
	// so a failure log shows the last steps before the bad Result without
	// flooding stdout when chat output is long.
	tailMessages = 20
)

// smokeBackends lists the four backends @zheng-li requires real e2e
// proof for at Phase 3.1 kickoff. The order here is the run order. A
// missing CLI for any entry fails the parent test (see TestCLISmoke).
var smokeBackends = []struct {
	agentType string // value passed to agent.New
	binary    string // default exec name; PATH-resolved per-run
}{
	{agentType: "claude", binary: "claude"},
	{agentType: "codex", binary: "codex"},
	{agentType: "hermes", binary: "hermes"},
	{agentType: "pi", binary: "pi"},
}

// TestCLISmoke drives each of the four required real-smoke backends
// through a single trivial prompt and asserts the SDK delivers a
// Result with Status="completed" AND non-empty user-visible output.
// Copilot is the fifth whitelisted backend in the SDK but is
// intentionally outside this suite (see the package comment above).
//
// Default `go test ./test/cli-smoke/...` skips. To opt in:
//
//	cd daemon && MEOWTH_CLI_SMOKE=1 go test ./test/cli-smoke/... -v
//
// Each backend runs as its own subtest so per-backend failures are
// observable individually. The parent test enforces a precondition
// before launching subtests: opt-in mode with a CLI missing for any
// of the four required backends fails fast, because the whole point
// of this suite is to prove the SDK drives those four real CLIs. A
// silent "0 backends actually ran" partial pass would invalidate the
// proof.
func TestCLISmoke(t *testing.T) {
	if os.Getenv(smokeEnvVar) != "1" {
		t.Skipf("cli-smoke is opt-in: set %s=1 to run real-CLI smoke (4 backends)", smokeEnvVar)
	}

	// Precondition gate (#2): in opt-in mode every required CLI must be
	// resolvable. We collect all misses so the operator sees the full
	// install list in one failure rather than one CLI per re-run.
	var missing []string
	for _, tc := range smokeBackends {
		if _, err := exec.LookPath(tc.binary); err != nil {
			missing = append(missing, fmt.Sprintf("%s (binary %q: %v)", tc.agentType, tc.binary, err))
		}
	}
	if len(missing) > 0 {
		t.Fatalf("%s=1 but %d required CLI(s) missing on PATH:\n  %s\n\nInstall the listed CLIs or unset %s; partial-smoke is not a supported mode.",
			smokeEnvVar, len(missing), strings.Join(missing, "\n  "), smokeEnvVar)
	}

	for _, tc := range smokeBackends {
		tc := tc
		t.Run(tc.agentType, func(t *testing.T) {
			runBackendSmoke(t, tc.agentType, tc.binary)
		})
	}
}

// runBackendSmoke executes one prompt against the named backend's local
// CLI. CLI resolvability was already enforced by TestCLISmoke's
// precondition gate, so a LookPath failure here is treated as a real
// test failure, not a Skip. The subtest fails when the SDK reports any
// Status other than "completed", or when the run completes silently
// (empty Result.Output and no MessageText carried content). On failure
// it logs CLI path + version, message transcript tail with the true
// total count, and the final Result fields.
func runBackendSmoke(t *testing.T, agentType, binary string) {
	t.Helper()

	cliPath, err := exec.LookPath(binary)
	if err != nil {
		// Should be unreachable thanks to the precondition gate in
		// TestCLISmoke. Treat any race (PATH mutation between gate
		// and subtest) as a hard failure rather than a Skip.
		t.Fatalf("[%s] CLI not on PATH (looked for %q): %v (precondition gate raced or PATH mutated)", agentType, binary, err)
	}
	cliVersion := detectCLIVersion(cliPath)
	t.Logf("[%s] cli_path=%s cli_version=%s", agentType, cliPath, cliVersion)

	cfg := agent.Config{ExecutablePath: cliPath}
	backend, err := agent.New(agentType, cfg)
	if err != nil {
		t.Fatalf("[%s] agent.New: %v", agentType, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), perTestTimeout)
	defer cancel()

	session, err := backend.Execute(ctx, minimalPrompt, agent.ExecOptions{})
	if err != nil {
		t.Fatalf("[%s] backend.Execute: %v", agentType, err)
	}

	drained := drainMessages(session)
	res := waitResult(t, agentType, session)

	// Composite acceptance (#1): the SDK said "completed" AND the run
	// actually produced user-visible content. Each backend's internal
	// state machine starts with `finalStatus := "completed"` and only
	// demotes on error, so a CLI that exits 0 without emitting any
	// answer (a fake `pi` of `exit 0`, or a real CLI that silently
	// drifted in a protocol upgrade) would otherwise look indistinguishable
	// from a real completed run. Require at least one non-empty signal:
	//   - Result.Output (cumulative text, populated by every backend on
	//     completed runs); OR
	//   - at least one MessageText with non-whitespace content
	//     (covers backends that stream content out via Messages without
	//     filling Result.Output).
	// Usage is intentionally NOT asserted: the four backends differ in
	// when (or whether) they emit usage events, and conflating token
	// accounting drift with e2e regression would be a false positive.
	statusOK := res.Status == "completed"
	outputOK := strings.TrimSpace(res.Output) != ""
	contentOK := drained.sawTextWithContent
	if statusOK && (outputOK || contentOK) {
		t.Logf("[%s] OK status=completed duration_ms=%d session_id=%q output_chars=%d message_count=%d text_with_content=%v",
			agentType, res.DurationMs, res.SessionID, len(res.Output), drained.totalCount, contentOK)
		return
	}

	// Strict-assertion failure — emit everything an operator needs to triage.
	if !statusOK {
		t.Logf("[%s] FAIL: expected Status=\"completed\", got %q", agentType, res.Status)
	} else {
		t.Logf("[%s] FAIL: status=completed but the run produced no user-visible content (Result.Output empty AND no MessageText carried content)", agentType)
	}
	t.Logf("[%s]   error=%q", agentType, res.Error)
	t.Logf("[%s]   duration_ms=%d", agentType, res.DurationMs)
	t.Logf("[%s]   session_id=%q", agentType, res.SessionID)
	t.Logf("[%s]   output (first 400 chars)=%q", agentType, trim(res.Output, 400))
	t.Logf("[%s]   usage_models=%d", agentType, len(res.Usage))
	t.Logf("[%s]   message tail (last %d of %d):", agentType, len(drained.tail), drained.totalCount)
	for i, m := range drained.tail {
		t.Logf("[%s]   [%d] type=%s tool=%q content=%q",
			agentType, i, m.Type, m.Tool, trim(m.Content, 200))
	}
	t.Fatalf("[%s] real-CLI smoke failed; see logs above", agentType)
}

// drainResult bundles the per-run signals the assertion needs from the
// streamed Messages channel: the trailing window for failure logs, the
// true total count (so "last N of M" stays accurate even when N == M
// hides truncation), and whether any MessageText with non-whitespace
// content was observed (composite acceptance #1).
type drainResult struct {
	tail               []agent.Message
	totalCount         int
	sawTextWithContent bool
}

// drainMessages consumes the session's Messages channel to completion,
// retaining only the trailing `tailMessages` entries for failure logs
// while still counting the true total. Returning early on test-context
// expiry isn't necessary: the SDK closes the channel when the backend
// exits, and ctx cancellation propagates into the backend so Execute
// already bounds the work.
func drainMessages(session *agent.Session) drainResult {
	out := drainResult{tail: make([]agent.Message, 0, tailMessages)}
	for msg := range session.Messages {
		out.totalCount++
		if len(out.tail) == tailMessages {
			out.tail = out.tail[1:]
		}
		out.tail = append(out.tail, msg)
		if msg.Type == agent.MessageText && strings.TrimSpace(msg.Content) != "" {
			out.sawTextWithContent = true
		}
	}
	return out
}

// waitResult blocks for the final Result with no extra deadline of its
// own; perTestTimeout on the parent context bounds total wall-clock and
// will close the Result channel via the backend on timeout. If the
// channel closes without delivering a Result (would indicate an SDK
// contract violation), the test fails with that fact rather than
// silently passing.
func waitResult(t *testing.T, agentType string, session *agent.Session) agent.Result {
	t.Helper()
	res, ok := <-session.Result
	if !ok {
		t.Fatalf("[%s] Session.Result channel closed without delivering a Result; SDK contract violation", agentType)
	}
	return res
}

// detectCLIVersion attempts `<binary> --version` with a short timeout.
// Best-effort: failures fall back to "(version probe failed)" so the
// transcript still shows what binary was probed.
func detectCLIVersion(cliPath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, cliPath, "--version").CombinedOutput()
	if err != nil {
		return fmt.Sprintf("(version probe failed: %v)", err)
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	if line == "" {
		return "(empty --version output)"
	}
	return line
}

// trim shortens long strings for the failure transcript while keeping
// enough context to diagnose what the backend last said.
func trim(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…[truncated]"
}

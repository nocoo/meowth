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

// smokeBackend names one of the four required real-smoke backends and
// the default executable to probe on PATH. Exposed as a named type so
// `missingRequiredCLIs` can be unit-tested with custom fixtures.
type smokeBackend struct {
	agentType string // value passed to agent.New
	binary    string // default exec name; PATH-resolved per-run
}

// smokeBackends lists the four backends @zheng-li requires real e2e
// proof for at Phase 3.1 kickoff. The order here is the run order. A
// missing CLI for any entry fails the parent test (see TestCLISmoke).
var smokeBackends = []smokeBackend{
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

	if missing := missingRequiredCLIs(smokeBackends, exec.LookPath); len(missing) > 0 {
		t.Fatalf("%s", missingCLIsMessage(smokeEnvVar, missing))
	}

	for _, tc := range smokeBackends {
		tc := tc
		t.Run(tc.agentType, func(t *testing.T) {
			runBackendSmoke(t, tc.agentType, tc.binary)
		})
	}
}

// lookPathFunc abstracts `exec.LookPath` so the precondition gate can
// be unit-tested without mutating process PATH.
type lookPathFunc func(file string) (string, error)

// missingRequiredCLIs returns one entry per backend whose binary the
// given lookup cannot resolve. An empty slice means every required CLI
// is on PATH. The returned strings include the agent type, the binary
// name probed, and the underlying lookup error so a hard-fail message
// can list everything an operator needs to install in one round.
func missingRequiredCLIs(backends []smokeBackend, lookup lookPathFunc) []string {
	var missing []string
	for _, tc := range backends {
		if _, err := lookup(tc.binary); err != nil {
			missing = append(missing, fmt.Sprintf("%s (binary %q: %v)", tc.agentType, tc.binary, err))
		}
	}
	return missing
}

// missingCLIsMessage formats the operator-facing message for a
// precondition failure. Extracted from TestCLISmoke so unit tests can
// assert it stays informative (lists every miss, names the env var,
// rejects the partial-smoke escape hatch) without invoking the test
// runner indirectly.
func missingCLIsMessage(envVar string, missing []string) string {
	return fmt.Sprintf(
		"%s=1 but %d required CLI(s) missing on PATH:\n  %s\n\nInstall the listed CLIs or unset %s; partial-smoke is not a supported mode.",
		envVar, len(missing), strings.Join(missing, "\n  "), envVar,
	)
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

	verdict := evaluateAcceptance(res, drained)
	if verdict.pass {
		t.Logf("[%s] OK status=completed duration_ms=%d session_id=%q output_chars=%d message_count=%d text_with_content=%v",
			agentType, res.DurationMs, res.SessionID, len(res.Output), drained.totalCount, drained.sawTextWithContent)
		return
	}

	// Strict-assertion failure — emit everything an operator needs to triage.
	t.Logf("[%s] FAIL: %s", agentType, verdict.failReason)
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

// acceptanceVerdict is the decision evaluateAcceptance returns. A pass
// run yields `{pass: true, failReason: ""}`; a fail yields
// `{pass: false, failReason: <human-readable single line>}` for the
// per-backend failure log header.
type acceptanceVerdict struct {
	pass       bool
	failReason string
}

// evaluateAcceptance is the policy engine for "did this real-CLI run
// actually prove the SDK drove the backend through to a useful end?".
// Composite acceptance: Status must be "completed" AND the run must
// have produced user-visible content via either Result.Output or at
// least one MessageText with non-whitespace content. Usage is
// deliberately not part of the rule — see the package comment and the
// rationale in runBackendSmoke.
//
// Pure function with no side effects: keeps the policy unit-testable
// without spinning up real binaries or fake processes.
func evaluateAcceptance(res agent.Result, drained drainResult) acceptanceVerdict {
	if res.Status != "completed" {
		return acceptanceVerdict{
			pass:       false,
			failReason: fmt.Sprintf("expected Status=\"completed\", got %q", res.Status),
		}
	}
	if strings.TrimSpace(res.Output) == "" && !drained.sawTextWithContent {
		return acceptanceVerdict{
			pass:       false,
			failReason: "status=completed but the run produced no user-visible content (Result.Output empty AND no MessageText carried content)",
		}
	}
	return acceptanceVerdict{pass: true}
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
	return drainMessagesFromChan(session.Messages)
}

// drainMessagesFromChan is drainMessages without the agent.Session
// dependency, so unit tests can feed a synthetic channel and assert
// the totalCount / tail / sawTextWithContent rules directly.
func drainMessagesFromChan(messages <-chan agent.Message) drainResult {
	out := drainResult{tail: make([]agent.Message, 0, tailMessages)}
	for msg := range messages {
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

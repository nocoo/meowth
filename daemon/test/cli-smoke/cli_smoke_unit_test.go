package clismoke

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

// TestMissingRequiredCLIsAllPresent locks the happy path: when every
// required CLI resolves, the precondition gate produces an empty miss
// list and TestCLISmoke can proceed to the per-backend subtests. This
// is the inverse of the negative-gate cases below and exists so a
// future refactor cannot accidentally turn the gate into one that
// always returns "missing" on a fully-installed host.
func TestMissingRequiredCLIsAllPresent(t *testing.T) {
	t.Parallel()
	lookup := func(name string) (string, error) {
		return "/fake/bin/" + name, nil
	}
	got := missingRequiredCLIs(smokeBackends, lookup)
	if len(got) != 0 {
		t.Fatalf("expected no missing CLIs when lookup always succeeds, got %v", got)
	}
}

// TestMissingRequiredCLIsAllMissing locks the negative gate that
// motivated the P5 amend: in opt-in mode a machine with zero installed
// CLIs must NOT silently pass via Skip — every required backend must
// appear in the miss list so the precondition fatal includes the full
// install hint, not one backend at a time.
func TestMissingRequiredCLIsAllMissing(t *testing.T) {
	t.Parallel()
	notFound := errors.New("executable file not found in $PATH")
	lookup := func(string) (string, error) { return "", notFound }
	got := missingRequiredCLIs(smokeBackends, lookup)
	if len(got) != len(smokeBackends) {
		t.Fatalf("expected every backend to be reported missing, got %d entries: %v",
			len(got), got)
	}
	for i, tc := range smokeBackends {
		if !strings.Contains(got[i], tc.agentType) || !strings.Contains(got[i], tc.binary) {
			t.Errorf("missing entry %d=%q should mention agent type %q and binary %q",
				i, got[i], tc.agentType, tc.binary)
		}
		if !strings.Contains(got[i], "not found") {
			t.Errorf("missing entry %d=%q should carry the lookup error reason", i, got[i])
		}
	}
}

// TestMissingRequiredCLIsPartiallyMissing covers the partial-miss case
// (one backend installed, others missing) explicitly so that the gate
// cannot regress to "only fail when 0 CLIs are present" — partial
// pass would still invalidate the four-backend proof.
func TestMissingRequiredCLIsPartiallyMissing(t *testing.T) {
	t.Parallel()
	notFound := errors.New("not found")
	lookup := func(name string) (string, error) {
		// only "claude" resolves; the other three must be reported missing.
		if name == "claude" {
			return "/fake/bin/claude", nil
		}
		return "", notFound
	}
	got := missingRequiredCLIs(smokeBackends, lookup)
	if len(got) != 3 {
		t.Fatalf("expected 3 missing backends (codex/hermes/pi), got %d: %v", len(got), got)
	}
	for _, entry := range got {
		if strings.Contains(entry, "claude") {
			t.Errorf("claude should not appear in missing list, got entry %q", entry)
		}
	}
}

// TestMissingCLIsMessageMentionsEveryMissAndRejectsPartialMode pins
// the operator-facing fatal text so its informational guarantees stay
// stable: it must (a) reference the env var, (b) include each missing
// entry verbatim, (c) explicitly refuse partial-smoke. If any of these
// disappear, the gate's failure becomes harder to act on.
func TestMissingCLIsMessageMentionsEveryMissAndRejectsPartialMode(t *testing.T) {
	t.Parallel()
	missing := []string{
		"claude (binary \"claude\": not found)",
		"pi (binary \"pi\": not found)",
	}
	msg := missingCLIsMessage(smokeEnvVar, missing)
	if !strings.Contains(msg, smokeEnvVar) {
		t.Errorf("message should reference env var %q, got %q", smokeEnvVar, msg)
	}
	for _, entry := range missing {
		if !strings.Contains(msg, entry) {
			t.Errorf("message should include entry %q, got %q", entry, msg)
		}
	}
	if !strings.Contains(msg, "partial-smoke is not a supported mode") {
		t.Errorf("message should explicitly reject partial-smoke; got %q", msg)
	}
	wantCount := fmt.Sprintf("%d required CLI", len(missing))
	if !strings.Contains(msg, wantCount) {
		t.Errorf("message should announce the miss count (%q), got %q", wantCount, msg)
	}
}

// TestEvaluateAcceptanceCompletedWithOutputPasses covers the most
// common happy path: the backend reports completed and Result.Output
// holds the cumulative text. Even if no MessageText carried content
// during the stream (codex / pi tend to emit a single result), output
// alone suffices.
func TestEvaluateAcceptanceCompletedWithOutputPasses(t *testing.T) {
	t.Parallel()
	verdict := evaluateAcceptance(
		agent.Result{Status: "completed", Output: "4"},
		drainResult{totalCount: 1},
	)
	if !verdict.pass {
		t.Fatalf("expected pass, got %+v", verdict)
	}
}

// TestEvaluateAcceptanceCompletedWithStreamedContentPasses covers the
// claude / hermes shape: Result.Output may be empty if all the
// content was streamed via MessageText. sawTextWithContent alone
// should suffice as the user-visible signal.
func TestEvaluateAcceptanceCompletedWithStreamedContentPasses(t *testing.T) {
	t.Parallel()
	verdict := evaluateAcceptance(
		agent.Result{Status: "completed", Output: ""},
		drainResult{totalCount: 5, sawTextWithContent: true},
	)
	if !verdict.pass {
		t.Fatalf("expected pass, got %+v", verdict)
	}
}

// TestEvaluateAcceptanceCompletedSilentFails is the
// `pi exit 0 with no output` case that P5 amend caught: the SDK
// reports completed but the run produced nothing visible. Acceptance
// must reject this — the failReason text must call out the empty
// visible content rather than masquerade as a generic non-completed.
func TestEvaluateAcceptanceCompletedSilentFails(t *testing.T) {
	t.Parallel()
	verdict := evaluateAcceptance(
		agent.Result{Status: "completed", Output: "  "}, // whitespace only
		drainResult{totalCount: 0, sawTextWithContent: false},
	)
	if verdict.pass {
		t.Fatalf("expected fail for silent completed run, got pass")
	}
	if !strings.Contains(verdict.failReason, "no user-visible content") {
		t.Errorf("failReason should mention empty visible content, got %q", verdict.failReason)
	}
}

// TestEvaluateAcceptanceNonCompletedFailsWithStatus pins the other
// fail branch: any non-"completed" Status — failed, aborted,
// cancelled, timeout — must lose, and the operator log must include
// the exact Status string so triage starts from the right place.
func TestEvaluateAcceptanceNonCompletedFailsWithStatus(t *testing.T) {
	t.Parallel()
	for _, status := range []string{"failed", "cancelled", "timeout", "aborted", ""} {
		status := status
		t.Run("status="+status, func(t *testing.T) {
			t.Parallel()
			verdict := evaluateAcceptance(
				agent.Result{Status: status, Output: "anything"},
				drainResult{sawTextWithContent: true},
			)
			if verdict.pass {
				t.Fatalf("expected fail for Status=%q, got pass", status)
			}
			if !strings.Contains(verdict.failReason, "completed") {
				t.Errorf("failReason should announce the expected status; got %q", verdict.failReason)
			}
			if status != "" && !strings.Contains(verdict.failReason, status) {
				t.Errorf("failReason should include the actual status %q; got %q", status, verdict.failReason)
			}
		})
	}
}

// TestDrainMessagesCountsAndTextDetectionUnderTailCap covers the three
// signals drainResult exposes: totalCount must equal the number of
// messages sent regardless of tail truncation, sawTextWithContent
// must reflect any non-whitespace MessageText seen anywhere in the
// stream (not just inside the tail window), and the tail must be at
// most tailMessages and contain the last entries (so triage logs the
// most recent context).
func TestDrainMessagesCountsAndTextDetectionUnderTailCap(t *testing.T) {
	t.Parallel()
	const total = tailMessages * 2 // exceed the cap so truncation matters
	ch := make(chan agent.Message, total)
	for i := 0; i < total; i++ {
		// Put the only meaningful text at the very start so the tail
		// window cannot have seen it; this guards against a future
		// implementation that derives sawTextWithContent from `tail`.
		if i == 0 {
			ch <- agent.Message{Type: agent.MessageText, Content: "early answer"}
			continue
		}
		// All later entries are status pings that should not flip
		// sawTextWithContent (wrong type + empty content).
		ch <- agent.Message{Type: agent.MessageStatus, Status: "running"}
	}
	close(ch)

	got := drainMessagesFromChan(ch)
	if got.totalCount != total {
		t.Errorf("totalCount = %d, want %d", got.totalCount, total)
	}
	if len(got.tail) != tailMessages {
		t.Errorf("len(tail) = %d, want %d", len(got.tail), tailMessages)
	}
	if !got.sawTextWithContent {
		t.Error("sawTextWithContent should be true because a non-empty MessageText was sent (even though it is no longer in the tail window)")
	}
	for i, m := range got.tail {
		if m.Type != agent.MessageStatus {
			t.Errorf("tail[%d].Type = %s, want MessageStatus (text was at index 0 and should have rolled off)", i, m.Type)
		}
	}
}

// TestDrainMessagesIgnoresWhitespaceOnlyText guards against treating a
// whitespace-only MessageText as user-visible content; the silent-pi
// failure depends on this rule staying tight.
func TestDrainMessagesIgnoresWhitespaceOnlyText(t *testing.T) {
	t.Parallel()
	ch := make(chan agent.Message, 3)
	ch <- agent.Message{Type: agent.MessageText, Content: "   "}
	ch <- agent.Message{Type: agent.MessageText, Content: "\n\t"}
	ch <- agent.Message{Type: agent.MessageStatus, Status: "running"}
	close(ch)

	got := drainMessagesFromChan(ch)
	if got.totalCount != 3 {
		t.Errorf("totalCount = %d, want 3", got.totalCount)
	}
	if got.sawTextWithContent {
		t.Error("sawTextWithContent should be false when only whitespace MessageText was seen")
	}
}

// TestDrainMessagesEmptyStream covers the boundary used by silent-pi:
// the SDK closes the channel with zero events. tail must be empty,
// totalCount zero, no spurious content flag.
func TestDrainMessagesEmptyStream(t *testing.T) {
	t.Parallel()
	ch := make(chan agent.Message)
	close(ch)

	got := drainMessagesFromChan(ch)
	if got.totalCount != 0 {
		t.Errorf("totalCount = %d, want 0", got.totalCount)
	}
	if len(got.tail) != 0 {
		t.Errorf("len(tail) = %d, want 0", len(got.tail))
	}
	if got.sawTextWithContent {
		t.Error("sawTextWithContent should be false on empty stream")
	}
}

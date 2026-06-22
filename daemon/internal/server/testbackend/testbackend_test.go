package testbackend

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

func drain(t *testing.T, sess *agent.Session) ([]agent.Message, agent.Result) {
	t.Helper()
	var msgs []agent.Message
	for m := range sess.Messages {
		msgs = append(msgs, m)
	}
	r, ok := <-sess.Result
	if !ok {
		t.Fatal("Result channel closed without value")
	}
	return msgs, r
}

func TestNewRejectsUnknownScenario(t *testing.T) {
	if _, err := New("mystery"); err == nil {
		t.Fatal("New accepted unknown scenario")
	}
}

func TestHappyScenarioReplays(t *testing.T) {
	f, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := f.Execute(context.Background(), "ignored", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	msgs, r := drain(t, sess)
	if len(msgs) == 0 {
		t.Fatal("expected at least one message")
	}
	if r.Status != "completed" {
		t.Fatalf("status = %q", r.Status)
	}
	if r.Usage == nil {
		t.Fatal("expected usage in happy scenario")
	}
}

func TestErrorScenario(t *testing.T) {
	f, err := New(ScenarioError)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := f.Execute(context.Background(), "", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	_, r := drain(t, sess)
	if r.Status != "failed" {
		t.Fatalf("status = %q", r.Status)
	}
	if r.Error == "" {
		t.Fatal("error string should be populated")
	}
}

func TestCancelledScenarioStopsOnContextCancel(t *testing.T) {
	f, err := New(ScenarioCancelled)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	sess, err := f.Execute(ctx, "", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	// Drain at least one message, then cancel before the pause
	// completes.
	got := 0
	go func() {
		for range sess.Messages {
			got++
			if got == 1 {
				cancel()
			}
		}
	}()
	select {
	case r := <-sess.Result:
		if r.Status != "cancelled" {
			t.Fatalf("status = %q, want cancelled", r.Status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for cancelled result")
	}
}

func TestIdleScenarioCompletesWithoutMessages(t *testing.T) {
	f, err := New(ScenarioIdle)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	f.MessageDelay = 0
	sess, err := f.Execute(context.Background(), "", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	msgs, r := drain(t, sess)
	// Idle scenario should emit 1 (status=started) message and then pause.
	if len(msgs) > 1 {
		t.Fatalf("unexpected message count: %d", len(msgs))
	}
	if r.Status != "completed" {
		t.Fatalf("status = %q", r.Status)
	}
}

func TestListEmbeddedScenarios(t *testing.T) {
	got, err := ListEmbeddedScenarios()
	if err != nil {
		t.Fatalf("ListEmbeddedScenarios: %v", err)
	}
	want := map[FixtureScenario]bool{
		ScenarioHappy:     true,
		ScenarioError:     true,
		ScenarioCancelled: true,
		ScenarioIdle:      true,
	}
	for _, s := range got {
		delete(want, s)
	}
	if len(want) != 0 {
		t.Fatalf("missing fixtures: %v", want)
	}
}

func TestScenarioForCoversAllSupportedTypes(t *testing.T) {
	for _, typ := range []string{"claude", "copilot", "codex", "hermes", "pi"} {
		s := ScenarioFor(typ)
		if s == "" {
			t.Fatalf("ScenarioFor(%q) = empty", typ)
		}
	}
}

func TestDefaultScenarioByBackendIsAlignedWithScenarioFor(t *testing.T) {
	for typ, s := range DefaultScenarioByBackend {
		if got := ScenarioFor(typ); got != s {
			t.Fatalf("DefaultScenarioByBackend[%q]=%q but ScenarioFor=%q", typ, s, got)
		}
	}
}

// docs/architecture/07 §11 L3 (b) — XSS spec drives untrusted text
// through the real session render path by asking the fake backend
// to echo a prompt-supplied payload. These cases pin the contract
// that the marker is opt-in (plain prompts are unchanged) and that
// the payload is emitted verbatim, before the fixture's messages.
func TestExecutePromptMarkerNotTriggeredByPlainPrompt(t *testing.T) {
	f, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	f.MessageDelay = 0
	sess, err := f.Execute(context.Background(), "hello world", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	baseline, r := drain(t, sess)
	if r.Status != "completed" {
		t.Fatalf("status = %q", r.Status)
	}
	for _, m := range baseline {
		if strings.Contains(m.Content, "MEOWTH_E2E_XSS_PAYLOAD") {
			t.Fatalf("plain prompt leaked marker into messages: %q", m.Content)
		}
	}
}

func TestExecutePromptMarkerEmitsPayloadFirst(t *testing.T) {
	const payload = `<script data-meowth-xss>window.__meowthXssFired=true</script>`
	f, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	f.MessageDelay = 0

	plain, err := f.Execute(context.Background(), "hello", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute plain: %v", err)
	}
	plainMsgs, _ := drain(t, plain)

	withMarker, err := f.Execute(context.Background(), promptMarkerXSSPayload+payload, agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute marker: %v", err)
	}
	markerMsgs, r := drain(t, withMarker)
	if r.Status != "completed" {
		t.Fatalf("status = %q", r.Status)
	}
	if len(markerMsgs) != len(plainMsgs)+1 {
		t.Fatalf("marker added %d messages, want exactly 1 (plain=%d, marker=%d)",
			len(markerMsgs)-len(plainMsgs), len(plainMsgs), len(markerMsgs))
	}
	if markerMsgs[0].Type != agent.MessageType("text") {
		t.Fatalf("marker[0].Type = %q, want text", markerMsgs[0].Type)
	}
	if markerMsgs[0].Content != payload {
		t.Fatalf("marker[0].Content = %q, want %q (verbatim)", markerMsgs[0].Content, payload)
	}
	// Rest of the stream matches the plain run.
	for i, m := range plainMsgs {
		if markerMsgs[i+1].Content != m.Content {
			t.Fatalf("message %d diverged: got %q, want %q", i+1, markerMsgs[i+1].Content, m.Content)
		}
	}
}

func TestExtractXSSPayload(t *testing.T) {
	cases := []struct {
		in     string
		ok     bool
		out    string
		reason string
	}{
		{"", false, "", "empty"},
		{"hello", false, "", "no prefix"},
		{"meowth_e2e_xss_payload:lower", false, "", "case sensitive"},
		{promptMarkerXSSPayload, true, "", "marker with empty payload"},
		{promptMarkerXSSPayload + "<script>x</script>", true, "<script>x</script>", "verbatim suffix"},
	}
	for _, c := range cases {
		got, ok := extractXSSPayload(c.in)
		if ok != c.ok || got != c.out {
			t.Fatalf("%s: extractXSSPayload(%q) = (%q,%v); want (%q,%v)",
				c.reason, c.in, got, ok, c.out, c.ok)
		}
	}
}

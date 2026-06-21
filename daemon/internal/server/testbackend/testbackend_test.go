package testbackend

import (
	"context"
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

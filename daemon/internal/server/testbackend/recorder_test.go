package testbackend

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/nocoo/meowth/daemon/pkg/agent"
)

// Tests for the test-only Execute recorder added in
// docs/features/03 commit #7. The recorder is a security
// surface: every assertion locks one of the §6.1 L2 contracts
// (field whitelist, redaction, gating).

// drainSession is a small helper that lets Execute's goroutine
// produce its messages + final result so test ordering is
// deterministic.
func drainSession(t *testing.T, sess *agent.Session) {
	t.Helper()
	for range sess.Messages {
		// drain
	}
	for range sess.Result {
		// drain
	}
}

func newRecorderEnv(t *testing.T) string {
	t.Helper()
	t.Setenv(envTest, "1")
	t.Setenv(envFactory, "fake")
	dir := t.TempDir()
	path := filepath.Join(dir, "chat-exec-log.jsonl")
	t.Setenv(envPath, path)
	resetRecorderStateForTest()
	return path
}

func TestRecorderDisabledWritesNothing(t *testing.T) {
	// Env unset → recorderEnabled() returns false → no file
	// created, no error from Execute.
	t.Setenv(envTest, "")
	t.Setenv(envFactory, "")
	dir := t.TempDir()
	path := filepath.Join(dir, "should-not-exist.jsonl")
	t.Setenv(envPath, path)
	resetRecorderStateForTest()

	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := fake.Execute(context.Background(), "hello", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	drainSession(t, sess)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("recorder file unexpectedly exists or stat error: %v", err)
	}
}

func TestRecorderEnabledWithoutPathWarns(t *testing.T) {
	// Env gate open but MEOWTH_CHAT_L2_RECORDER_PATH unset →
	// no file is created and Execute still succeeds. We can't
	// easily intercept os.Stderr cleanly here, so we just lock
	// that the path remains absent.
	t.Setenv(envTest, "1")
	t.Setenv(envFactory, "fake")
	t.Setenv(envPath, "")
	dir := t.TempDir()
	stray := filepath.Join(dir, "should-not-exist.jsonl")
	resetRecorderStateForTest()

	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := fake.Execute(context.Background(), "hello", agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	drainSession(t, sess)
	if _, err := os.Stat(stray); !os.IsNotExist(err) {
		t.Fatalf("recorder unexpectedly wrote to a path: %v", err)
	}
}

func TestRecorderRecordsExactWhitelistedFields(t *testing.T) {
	path := newRecorderEnv(t)
	t.Setenv(envMarker, "marker-A")

	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := fake.Execute(context.Background(), "hello", agent.ExecOptions{
		ResumeSessionID: "bsid-abc",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	drainSession(t, sess)

	// #nosec G304 — path from t.TempDir
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read recorder file: %v", err)
	}
	lines := bytes.Split(bytes.TrimSpace(body), []byte("\n"))
	if len(lines) != 1 {
		t.Fatalf("expected 1 record, got %d", len(lines))
	}

	// Decode into a map so we can assert the exact key set, not
	// just the typed fields the struct happens to expose.
	var asMap map[string]any
	if err := json.Unmarshal(lines[0], &asMap); err != nil {
		t.Fatalf("unmarshal record: %v", err)
	}
	wantKeys := map[string]bool{
		"backend_type":      true,
		"call_seq":          true,
		"resume_session_id": true,
		"prompt_length":     true,
		"test_marker":       true,
	}
	if len(asMap) != len(wantKeys) {
		t.Fatalf("record has %d keys, want %d. Keys: %v", len(asMap), len(wantKeys), asMap)
	}
	for k := range asMap {
		if !wantKeys[k] {
			t.Fatalf("record has unexpected key %q (whitelist regression). Full record: %v", k, asMap)
		}
	}

	// Spot-check typed values.
	var rec execRecord
	if err := json.Unmarshal(lines[0], &rec); err != nil {
		t.Fatalf("unmarshal typed: %v", err)
	}
	if rec.BackendType != "fake" {
		t.Errorf("BackendType = %q, want fake", rec.BackendType)
	}
	if rec.CallSeq != 1 {
		t.Errorf("CallSeq = %d, want 1 (counter was reset)", rec.CallSeq)
	}
	if rec.ResumeSessionID != "bsid-abc" {
		t.Errorf("ResumeSessionID = %q, want bsid-abc", rec.ResumeSessionID)
	}
	if rec.PromptLength != len("hello") {
		t.Errorf("PromptLength = %d, want %d", rec.PromptLength, len("hello"))
	}
	if rec.TestMarker != "marker-A" {
		t.Errorf("TestMarker = %q, want marker-A", rec.TestMarker)
	}
}

func TestRecorderCallSeqMonotonic(t *testing.T) {
	path := newRecorderEnv(t)
	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for i := 0; i < 3; i++ {
		sess, err := fake.Execute(context.Background(), "ping", agent.ExecOptions{})
		if err != nil {
			t.Fatalf("Execute %d: %v", i, err)
		}
		drainSession(t, sess)
	}
	// #nosec G304 — path from t.TempDir
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read recorder file: %v", err)
	}
	lines := bytes.Split(bytes.TrimSpace(body), []byte("\n"))
	if len(lines) != 3 {
		t.Fatalf("expected 3 records, got %d", len(lines))
	}
	for i, line := range lines {
		var rec execRecord
		if err := json.Unmarshal(line, &rec); err != nil {
			t.Fatalf("unmarshal line %d: %v", i, err)
		}
		want := uint64(i + 1)
		if rec.CallSeq != want {
			t.Errorf("line %d: CallSeq = %d, want %d", i, rec.CallSeq, want)
		}
	}
}

func TestRecorderPromptLengthIsByteCount(t *testing.T) {
	path := newRecorderEnv(t)
	const prompt = "hello\n" // 6 bytes
	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := fake.Execute(context.Background(), prompt, agent.ExecOptions{})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	drainSession(t, sess)
	// #nosec G304 — path from t.TempDir
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read recorder file: %v", err)
	}
	var rec execRecord
	if err := json.Unmarshal(bytes.TrimSpace(body), &rec); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if rec.PromptLength != 6 {
		t.Errorf("PromptLength = %d, want 6 (byte count, not rune count)", rec.PromptLength)
	}
}

// TestRecorderRedactsSecretsGolden is the security red-line test.
// It feeds Execute a prompt full of secret-looking substrings and
// asserts that NONE of them appear in the on-disk record. Failure
// here means the recorder leaked secret material despite the
// whitelist; treat as a P0.
func TestRecorderRedactsSecretsGolden(t *testing.T) {
	path := newRecorderEnv(t)
	const prompt = "secret-mwt_AAA111 password=foo Authorization: Bearer mws_BBB"
	fake, err := New(ScenarioHappy)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sess, err := fake.Execute(context.Background(), prompt, agent.ExecOptions{
		// also pass a forbidden-looking string in an opt field that
		// the recorder MUST NOT touch.
		SystemPrompt: "system-mwt_CCC222",
		CustomArgs:   []string{"--token", "mwt_DDD333"},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	drainSession(t, sess)

	// #nosec G304 — path from t.TempDir
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read recorder file: %v", err)
	}
	out := string(body)
	forbidden := []string{
		"secret",
		"mwt_AAA",
		"mwt_CCC",
		"mwt_DDD",
		"mws_BBB",
		"password",
		"Authorization",
		"Bearer",
		"system-",
	}
	for _, needle := range forbidden {
		if strings.Contains(out, needle) {
			t.Errorf("recorder leaked forbidden substring %q. File contents: %s", needle, out)
		}
	}
	// Positive sanity: the byte length of the prompt is recorded.
	wantLenSubstr := "\"prompt_length\":" + strconv.Itoa(len(prompt))
	if !strings.Contains(out, wantLenSubstr) {
		t.Errorf("recorder did not record expected prompt length substring %q. File contents: %s", wantLenSubstr, out)
	}
}

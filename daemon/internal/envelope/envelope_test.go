package envelope

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuilderEmitsMonotonicSeq(t *testing.T) {
	b := NewBuilder("sess-1")
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	env, err := b.SessionStarted(now, SessionStartedPayload{BackendType: "claude", StartedAt: now})
	if err != nil {
		t.Fatalf("SessionStarted: %v", err)
	}
	if env.Seq != 0 {
		t.Fatalf("seq = %d, want 0", env.Seq)
	}
	if env.V != SchemaVersion {
		t.Fatalf("v = %d, want %d", env.V, SchemaVersion)
	}
	if env.SessionID != "sess-1" {
		t.Fatalf("session_id = %q", env.SessionID)
	}
	env2, err := b.Message(now, MessagePayload{Kind: "text", Content: "hi"})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	if env2.Seq != 1 {
		t.Fatalf("seq = %d, want 1", env2.Seq)
	}
}

func TestMessageRequiresKind(t *testing.T) {
	b := NewBuilder("sess")
	if _, err := b.Message(time.Now(), MessagePayload{Content: "hi"}); err == nil {
		t.Fatal("Message accepted empty kind")
	}
}

func TestErrorRequiresCodeAndTitle(t *testing.T) {
	b := NewBuilder("sess")
	if _, err := b.Error(time.Now(), ErrorPayload{}); err == nil {
		t.Fatal("Error accepted empty code/title")
	}
	if _, err := b.Error(time.Now(), ErrorPayload{Code: "x"}); err == nil {
		t.Fatal("Error accepted empty title")
	}
}

func TestSessionEndedRequiresStatus(t *testing.T) {
	b := NewBuilder("sess")
	if _, err := b.SessionEnded(time.Now(), SessionEndedPayload{}); err == nil {
		t.Fatal("SessionEnded accepted empty status")
	}
}

func TestEncodeLineRoundtrip(t *testing.T) {
	b := NewBuilder("sess-rt")
	env, err := b.Message(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), MessagePayload{
		Kind:    "text",
		Content: "hello\nworld",
	})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	line, err := EncodeLine(env)
	if err != nil {
		t.Fatalf("EncodeLine: %v", err)
	}
	if !bytes.HasSuffix(line, []byte("\n")) {
		t.Fatalf("line missing trailing \\n: %q", line)
	}
	if bytes.IndexByte(line, '\r') != -1 {
		t.Fatalf("line contains CR")
	}
	got, err := DecodeLine(line)
	if err != nil {
		t.Fatalf("DecodeLine: %v", err)
	}
	if got.Type != TypeMessage || got.Seq != env.Seq {
		t.Fatalf("roundtrip mismatch: %+v", got)
	}
	var p MessagePayload
	if err := json.Unmarshal(got.Payload, &p); err != nil {
		t.Fatalf("payload decode: %v", err)
	}
	if p.Content != "hello\nworld" {
		t.Fatalf("content roundtrip mismatch: %q", p.Content)
	}
}

func TestDecodeRejectsBOM(t *testing.T) {
	body := append([]byte{0xEF, 0xBB, 0xBF}, []byte(`{"v":1,"seq":0,"ts":"2026-01-01T00:00:00Z","session_id":"x","type":"heartbeat","payload":{"since_last_message_ms":0}}`)...)
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted BOM")
	}
}

func TestDecodeRejectsCR(t *testing.T) {
	body := []byte("{\"v\":1,\"seq\":0,\"ts\":\"2026-01-01T00:00:00Z\",\"session_id\":\"x\",\"type\":\"heartbeat\",\"payload\":{}}\r\n")
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted CR")
	}
}

func TestDecodeRejectsUnknownType(t *testing.T) {
	body := []byte(`{"v":1,"seq":0,"ts":"2026-01-01T00:00:00Z","session_id":"x","type":"meow","payload":{}}` + "\n")
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted unknown type")
	}
}

func TestDecodeRejectsBadVersion(t *testing.T) {
	body := []byte(`{"v":2,"seq":0,"ts":"2026-01-01T00:00:00Z","session_id":"x","type":"heartbeat","payload":{}}` + "\n")
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted v=2")
	}
}

func TestTruncateMessageContent(t *testing.T) {
	b := NewBuilder("sess-trunc")
	// Build a message that exceeds the 1 MiB cap.
	big := strings.Repeat("a", MaxLineBytes+1024)
	env, err := b.Message(time.Now(), MessagePayload{Kind: "text", Content: big})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	out, errPayload, truncated, err := TruncateMessageContent(env)
	if err != nil {
		t.Fatalf("TruncateMessageContent: %v", err)
	}
	if !truncated {
		t.Fatal("expected truncated=true")
	}
	line, err := EncodeLine(out)
	if err != nil {
		t.Fatalf("re-encode: %v", err)
	}
	if len(line) > MaxLineBytes {
		t.Fatalf("after truncate len=%d, want ≤ %d", len(line), MaxLineBytes)
	}
	if errPayload.Code != "message_truncated" {
		t.Fatalf("errPayload.code = %q", errPayload.Code)
	}
}

func TestTruncateLeavesShortMessageAlone(t *testing.T) {
	b := NewBuilder("sess-short")
	env, err := b.Message(time.Now(), MessagePayload{Kind: "text", Content: "small"})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	_, _, truncated, err := TruncateMessageContent(env)
	if err != nil {
		t.Fatalf("TruncateMessageContent: %v", err)
	}
	if truncated {
		t.Fatal("short message should not be truncated")
	}
}

func TestStatusFromAgentResult(t *testing.T) {
	for _, s := range []string{"completed", "failed", "aborted", "timeout", "cancelled"} {
		if got := StatusFromAgentResult(s); got != s {
			t.Fatalf("StatusFromAgentResult(%q) = %q", s, got)
		}
	}
	if got := StatusFromAgentResult(""); got != "failed" {
		t.Fatalf("StatusFromAgentResult empty → %q, want failed", got)
	}
	if got := StatusFromAgentResult("garbage"); got != "failed" {
		t.Fatalf("StatusFromAgentResult garbage → %q, want failed", got)
	}
}

// validHeartbeatLine returns a single canonical envelope line for
// the trailing-data tests below.
func validHeartbeatLine() []byte {
	return []byte(`{"v":1,"seq":0,"ts":"2026-06-21T12:00:00Z","session_id":"s","type":"heartbeat","payload":{"since_last_message_ms":0}}`)
}

func TestDecodeRejectsTrailingJSONObject(t *testing.T) {
	// Reviewer-cited regression: two top-level objects glued
	// together must NOT be silently accepted as the first one.
	body := append(validHeartbeatLine(), validHeartbeatLine()...)
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted glued-together objects")
	}
}

func TestDecodeRejectsTrailingNonWhitespaceToken(t *testing.T) {
	body := append(validHeartbeatLine(), []byte("trailing")...)
	if _, err := DecodeLine(body); err == nil {
		t.Fatal("DecodeLine accepted trailing non-whitespace bytes")
	}
}

func TestDecodeAcceptsSingleTrailingNewline(t *testing.T) {
	body := append(validHeartbeatLine(), '\n')
	if _, err := DecodeLine(body); err != nil {
		t.Fatalf("DecodeLine rejected canonical trailing newline: %v", err)
	}
}

func TestDecodeAcceptsTrailingWhitespaceMix(t *testing.T) {
	// Spaces and tabs are JSON whitespace; allow them.
	body := append(validHeartbeatLine(), []byte("  \t\n")...)
	if _, err := DecodeLine(body); err != nil {
		t.Fatalf("DecodeLine rejected whitespace tail: %v", err)
	}
}

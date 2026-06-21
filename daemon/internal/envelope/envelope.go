// Package envelope owns the docs/architecture/02 §5 NDJSON event
// schema the daemon emits over /v1/agents/{type}/exec and persists
// in the messages table. Every envelope on the wire and on disk
// flows through this package's constructors and Encode helpers, so
// the schema lives in one place and tests assert it once.
package envelope

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// SchemaVersion is the envelope schema version (docs/architecture/02
// §5.1 `v`). Locked at 1 for v1.
const SchemaVersion = 1

// MaxLineBytes is docs/architecture/02 §5.8's 1 MiB per-line cap.
const MaxLineBytes = 1 << 20

// TruncationHeadroom is the safety margin we trim off MaxLineBytes
// before re-checking the truncated envelope. The 4 KiB allowance
// accounts for envelope framing (timestamp, uuid, type, etc.).
const TruncationHeadroom = 4 << 10

// Type is the envelope `type` value (docs/architecture/02 §5.1).
type Type string

const (
	TypeSessionStarted Type = "session_started"
	TypeMessage        Type = "message"
	TypeUsage          Type = "usage"
	TypeError          Type = "error"
	TypeSessionEnded   Type = "session_ended"
	TypeHeartbeat      Type = "heartbeat"
)

// IsValid reports whether the type is one of the canonical enum
// strings.
func (t Type) IsValid() bool {
	switch t {
	case TypeSessionStarted, TypeMessage, TypeUsage, TypeError, TypeSessionEnded, TypeHeartbeat:
		return true
	}
	return false
}

// Envelope is the docs/architecture/02 §5.1 outer object. Payload
// is `json.RawMessage` so the package can carry any type-specific
// payload without typing the struct here; per-type constructors
// below build the right shape.
type Envelope struct {
	V         int             `json:"v"`
	Seq       int64           `json:"seq"`
	TS        time.Time       `json:"ts"`
	SessionID string          `json:"session_id"`
	Type      Type            `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// SessionStartedPayload — docs/architecture/02 §5.2.
type SessionStartedPayload struct {
	BackendType      string    `json:"backend_type"`
	BackendSessionID string    `json:"backend_session_id"`
	StartedAt        time.Time `json:"started_at"`
}

// MessagePayload — docs/architecture/02 §5.3. Only the fields that
// apply to the kind appear; daemon producers leave the others as
// their JSON zero values (string="", map=nil → omitempty).
type MessagePayload struct {
	Kind             string         `json:"kind"`
	Content          string         `json:"content,omitempty"`
	Tool             string         `json:"tool,omitempty"`
	CallID           string         `json:"call_id,omitempty"`
	Input            map[string]any `json:"input,omitempty"`
	Output           string         `json:"output,omitempty"`
	Status           string         `json:"status,omitempty"`
	Level            string         `json:"level,omitempty"`
	BackendSessionID string         `json:"backend_session_id,omitempty"`
}

// UsagePerModel — usage_payload.models[*]; docs/architecture/02 §5.4.
type UsagePerModel struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
}

// UsagePayload — docs/architecture/02 §5.4.
type UsagePayload struct {
	Models map[string]UsagePerModel `json:"models"`
}

// SessionEndedPayload — docs/architecture/02 §5.5.
type SessionEndedPayload struct {
	Status           string                   `json:"status"`
	OutputChars      int                      `json:"output_chars"`
	Error            string                   `json:"error"`
	DurationMS       int64                    `json:"duration_ms"`
	BackendSessionID string                   `json:"backend_session_id,omitempty"`
	Usage            map[string]UsagePerModel `json:"usage,omitempty"`
}

// ErrorPayload — docs/architecture/02 §5.6.
type ErrorPayload struct {
	Code      string `json:"code"`
	Title     string `json:"title"`
	Detail    string `json:"detail,omitempty"`
	Retryable bool   `json:"retryable"`
}

// HeartbeatPayload — docs/architecture/02 §5.7.
type HeartbeatPayload struct {
	SinceLastMessageMS int64 `json:"since_last_message_ms"`
}

// Builder mints monotonic seq + ts envelopes for a single session.
// Construct via NewBuilder; use the per-type helpers to obtain a
// signed envelope.
type Builder struct {
	sessionID string
	nextSeq   int64
}

// NewBuilder starts a builder at seq=0 for the given session id.
func NewBuilder(sessionID string) *Builder {
	return &Builder{sessionID: sessionID}
}

// SessionID returns the session this builder mints envelopes for.
func (b *Builder) SessionID() string { return b.sessionID }

// PeekSeq returns the next seq the builder will use without
// incrementing it.
func (b *Builder) PeekSeq() int64 { return b.nextSeq }

// SessionStarted constructs envelope[0] for a new session.
func (b *Builder) SessionStarted(now time.Time, p SessionStartedPayload) (Envelope, error) {
	return b.build(now, TypeSessionStarted, p)
}

// Message wraps a §5.3 agent.Message envelope.
func (b *Builder) Message(now time.Time, p MessagePayload) (Envelope, error) {
	if p.Kind == "" {
		return Envelope{}, errors.New("envelope: message.kind required")
	}
	return b.build(now, TypeMessage, p)
}

// Usage constructs a §5.4 usage event.
func (b *Builder) Usage(now time.Time, p UsagePayload) (Envelope, error) {
	return b.build(now, TypeUsage, p)
}

// Error constructs a §5.6 daemon-side wire error event.
func (b *Builder) Error(now time.Time, p ErrorPayload) (Envelope, error) {
	if p.Code == "" || p.Title == "" {
		return Envelope{}, errors.New("envelope: error.code and title required")
	}
	return b.build(now, TypeError, p)
}

// Heartbeat constructs a §5.7 keepalive event.
func (b *Builder) Heartbeat(now time.Time, p HeartbeatPayload) (Envelope, error) {
	return b.build(now, TypeHeartbeat, p)
}

// SessionEnded constructs the terminal §5.5 event. The builder
// returns the envelope; the caller is responsible for ensuring no
// further envelopes are emitted on the stream.
func (b *Builder) SessionEnded(now time.Time, p SessionEndedPayload) (Envelope, error) {
	if p.Status == "" {
		return Envelope{}, errors.New("envelope: session_ended.status required")
	}
	return b.build(now, TypeSessionEnded, p)
}

func (b *Builder) build(now time.Time, t Type, payload any) (Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, fmt.Errorf("envelope: marshal payload: %w", err)
	}
	env := Envelope{
		V:         SchemaVersion,
		Seq:       b.nextSeq,
		TS:        now.UTC().Truncate(time.Millisecond),
		SessionID: b.sessionID,
		Type:      t,
		Payload:   raw,
	}
	b.nextSeq++
	return env, nil
}

// EncodeLine renders the envelope as a single docs/architecture/02
// §5.8 wire line: strict UTF-8 JSON, no BOM, terminated by exactly
// one `\n`. Caller validates that the result is ≤ MaxLineBytes via
// TruncateIfOverlong before writing.
func EncodeLine(env Envelope) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(env); err != nil {
		return nil, fmt.Errorf("envelope: encode: %w", err)
	}
	out := buf.Bytes()
	// json.Encoder appends '\n' already; verify there is no extra
	// trailing content. Reject CRLF embedded inside the envelope
	// (Encoder won't produce one, but defence in depth).
	if i := bytes.IndexByte(out, '\r'); i != -1 {
		return nil, fmt.Errorf("envelope: encoded line contains CR at offset %d", i)
	}
	return out, nil
}

// TruncateMessageContent enforces docs/architecture/02 §5.8: a
// MessagePayload whose envelope exceeds MaxLineBytes has its
// content trimmed to (MaxLineBytes - TruncationHeadroom). Returns
// (truncatedEnvelope, true) when truncation occurred plus a
// follow-up ErrorPayload the caller should emit immediately after
// the truncated message.
func TruncateMessageContent(env Envelope) (Envelope, ErrorPayload, bool, error) {
	if env.Type != TypeMessage {
		return env, ErrorPayload{}, false, nil
	}
	line, err := EncodeLine(env)
	if err != nil {
		return env, ErrorPayload{}, false, err
	}
	if len(line) <= MaxLineBytes {
		return env, ErrorPayload{}, false, nil
	}

	var p MessagePayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return env, ErrorPayload{}, false, fmt.Errorf("envelope: re-decode message payload: %w", err)
	}
	// Compute the budget we have for content after subtracting the
	// rest of the envelope. EncodeLine is monotonic in
	// len(content); shrink iteratively to honor the headroom.
	overhead := len(line) - len(p.Content)
	maxContent := MaxLineBytes - TruncationHeadroom - overhead
	if maxContent < 0 {
		maxContent = 0
	}
	if maxContent > len(p.Content) {
		maxContent = len(p.Content)
	}
	p.Content = safeTruncateRunes(p.Content, maxContent)
	raw, err := json.Marshal(p)
	if err != nil {
		return env, ErrorPayload{}, false, fmt.Errorf("envelope: re-marshal truncated payload: %w", err)
	}
	env.Payload = raw

	// Confirm we are now under the limit; if the re-marshal still
	// overflows (unlikely — JSON escapes can grow), drop more.
	for {
		line, err := EncodeLine(env)
		if err != nil {
			return env, ErrorPayload{}, false, err
		}
		if len(line) <= MaxLineBytes {
			break
		}
		if maxContent == 0 {
			return env, ErrorPayload{}, false, errors.New("envelope: cannot trim message under MaxLineBytes")
		}
		maxContent /= 2
		p.Content = safeTruncateRunes(p.Content, maxContent)
		raw, err = json.Marshal(p)
		if err != nil {
			return env, ErrorPayload{}, false, err
		}
		env.Payload = raw
	}

	errPayload := ErrorPayload{
		Code:      "message_truncated",
		Title:     "Message content truncated",
		Detail:    "the upstream backend produced a single message that exceeded the daemon's 1 MiB per-line cap; later content has been dropped",
		Retryable: false,
	}
	return env, errPayload, true, nil
}

// safeTruncateRunes trims s so the resulting string is at most n
// bytes without splitting a UTF-8 rune.
func safeTruncateRunes(s string, n int) string {
	if n >= len(s) {
		return s
	}
	if n <= 0 {
		return ""
	}
	// Walk back from n until we land on a rune boundary.
	for i := n; i > 0; i-- {
		if isUTF8RuneBoundary(s, i) {
			return s[:i]
		}
	}
	return ""
}

func isUTF8RuneBoundary(s string, i int) bool {
	if i == 0 || i == len(s) {
		return true
	}
	return (s[i] & 0xC0) != 0x80
}

// DecodeLine parses a single wire line. Rejects BOM, CR, and any
// trailing data after the first JSON object — docs/architecture/
// 02 §5.1/§5.8 mandates one envelope per line. A single trailing
// newline is tolerated (the canonical wire form ends each line
// with `\n`), but additional non-whitespace bytes are rejected.
func DecodeLine(line []byte) (Envelope, error) {
	if len(line) >= 3 && line[0] == 0xEF && line[1] == 0xBB && line[2] == 0xBF {
		return Envelope{}, errors.New("envelope: BOM not permitted")
	}
	if i := bytes.IndexByte(line, '\r'); i != -1 {
		return Envelope{}, fmt.Errorf("envelope: CR at offset %d not permitted", i)
	}
	if len(line) == 0 {
		return Envelope{}, errors.New("envelope: empty line")
	}

	var env Envelope
	dec := json.NewDecoder(bytes.NewReader(line))
	if err := dec.Decode(&env); err != nil {
		return Envelope{}, fmt.Errorf("envelope: decode: %w", err)
	}
	// Trailing-data check: any non-whitespace byte after the first
	// object is a contract violation. We allow at most a single
	// "\n" (the canonical line terminator). The Decoder skips
	// JSON-grade whitespace; checking the remaining bytes against
	// JSON whitespace catches the legal cases without relying on
	// a second Decode (a second Decode would accept `{...}{...}`
	// after stripping the trailing newline).
	if !onlyWhitespaceLeft(line, dec) {
		return Envelope{}, errors.New("envelope: trailing data after JSON object")
	}
	if !env.Type.IsValid() {
		return Envelope{}, fmt.Errorf("envelope: unknown type %q", env.Type)
	}
	if env.V != SchemaVersion {
		return Envelope{}, fmt.Errorf("envelope: unsupported v=%d", env.V)
	}
	return env, nil
}

// onlyWhitespaceLeft returns true when the bytes still buffered in
// the decoder + the rest of the source contain nothing but JSON
// whitespace (space, tab, \n, \r). docs/architecture/02 §5.8
// already forbids \r, so CR is rejected separately above; this
// helper allows tabs/spaces/newlines for tolerance.
func onlyWhitespaceLeft(src []byte, dec *json.Decoder) bool {
	// json.Decoder.InputOffset is the position just after the
	// first valid token sequence ended — i.e. immediately after
	// the closing '}' of the top-level object. Anything else in
	// `src` after that offset is trailing data.
	off := dec.InputOffset()
	for i := int(off); i < len(src); i++ {
		c := src[i]
		switch c {
		case ' ', '\t', '\n':
			continue
		default:
			return false
		}
	}
	return true
}

// StatusFromAgentResult maps the agent SDK's Result.Status string
// to a docs/architecture/02 §5.5 session_ended status. The agent
// strings map 1:1; this helper exists so the conversion lives in
// one place.
func StatusFromAgentResult(s string) string {
	s = strings.TrimSpace(s)
	switch s {
	case "completed", "failed", "aborted", "timeout", "cancelled":
		return s
	default:
		return "failed"
	}
}

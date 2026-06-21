package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/nocoo/meowth/daemon/internal/store/gen"
)

// EventType is the docs/architecture/02 §5 + §5.1 envelope `type`
// enum. Tracked as a column on messages so docs/architecture/03 §7's
// types= filter (02 §6.4) can run without parsing envelope_json.
type EventType string

const (
	EventSessionStarted EventType = "session_started"
	EventMessage        EventType = "message"
	EventUsage          EventType = "usage"
	EventError          EventType = "error"
	EventSessionEnded   EventType = "session_ended"
	EventHeartbeat      EventType = "heartbeat"
)

// IsValid reports whether the value is one of the canonical enum
// strings.
func (e EventType) IsValid() bool {
	switch e {
	case EventSessionStarted, EventMessage, EventUsage, EventError, EventSessionEnded, EventHeartbeat:
		return true
	}
	return false
}

// MessageRow is the projection used by snapshot replay. Holds the
// FULL envelope JSON bytes the wire originally emitted (docs/
// architecture/03 §7.1).
type MessageRow struct {
	Seq          int64
	EventType    EventType
	TS           time.Time // event timestamp; unix milliseconds on disk
	EnvelopeJSON []byte
}

// AppendMessageParams collects the fields the pump writes for each
// envelope.
type AppendMessageParams struct {
	SessionID    string
	Seq          int64
	EventType    EventType
	TS           time.Time // wall-clock at envelope emit; stored as unix ms
	EnvelopeJSON []byte
}

// AppendMessage writes one envelope row. Caller MUST persist
// successfully before writing the same envelope bytes to the HTTP
// response (docs/architecture/03 §7.2). On error the caller must
// abort the stream per docs/architecture/03 §7.2 last paragraph.
func AppendMessage(ctx context.Context, db *sql.DB, p AppendMessageParams) error {
	if p.SessionID == "" {
		return errors.New("store: session_id required")
	}
	if !p.EventType.IsValid() {
		return fmt.Errorf("store: invalid event_type %q", p.EventType)
	}
	if len(p.EnvelopeJSON) == 0 {
		return errors.New("store: envelope_json required")
	}
	if err := gen.New(db).InsertMessage(ctx, gen.InsertMessageParams{
		SessionID:    p.SessionID,
		Seq:          p.Seq,
		EventType:    string(p.EventType),
		Ts:           p.TS.UTC().UnixMilli(),
		EnvelopeJson: p.EnvelopeJSON,
	}); err != nil {
		return fmt.Errorf("store: append message: %w", err)
	}
	return nil
}

// ListMessagesAfterSeqParams collects the §6.4 query parameters.
type ListMessagesAfterSeqParams struct {
	SessionID string
	AfterSeq  int64
	Limit     int64
}

// ListMessagesAfterSeq returns the snapshot slice docs/architecture/
// 02 §6.4 needs. Filtering by `types` is left to the caller — the
// store-level helper returns all event types in seq order so the
// HTTP handler can decide.
func ListMessagesAfterSeq(ctx context.Context, db *sql.DB, p ListMessagesAfterSeqParams) ([]MessageRow, error) {
	rows, err := gen.New(db).ListMessagesAfterSeq(ctx, gen.ListMessagesAfterSeqParams{
		SessionID: p.SessionID,
		Seq:       p.AfterSeq,
		Limit:     p.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("store: list messages: %w", err)
	}
	out := make([]MessageRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, MessageRow{
			Seq:          r.Seq,
			EventType:    EventType(r.EventType),
			TS:           time.UnixMilli(r.Ts).UTC(),
			EnvelopeJSON: r.EnvelopeJson,
		})
	}
	return out, nil
}

// CountMessagesForSession returns the number of envelope rows for a
// session. Used by tests to assert the SQLite trail mirrors the
// stream.
func CountMessagesForSession(ctx context.Context, db *sql.DB, sessionID string) (int64, error) {
	n, err := gen.New(db).CountMessagesForSession(ctx, sessionID)
	if err != nil {
		return 0, fmt.Errorf("store: count messages: %w", err)
	}
	return n, nil
}

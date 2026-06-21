package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/home"
)

func newMessagesDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	bs, err := sql.Open(DriverName(), "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("bootstrap open: %v", err)
	}
	if err := EnsureTestMarker(context.Background(), bs); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bs.Close()
	db, err := Open(context.Background(), h)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	id, _ := uuid.NewV7()
	sessionID := id.String()
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: sessionID, BackendType: BackendClaude, DaemonPID: 1, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	return db, sessionID
}

func TestAppendMessageAndList(t *testing.T) {
	db, sessionID := newMessagesDB(t)
	ts := time.Now().UTC()
	for i := 0; i < 4; i++ {
		typ := EventMessage
		if i == 0 {
			typ = EventSessionStarted
		}
		if err := AppendMessage(context.Background(), db, AppendMessageParams{
			SessionID:    sessionID,
			Seq:          int64(i),
			EventType:    typ,
			TS:           ts.Add(time.Duration(i) * time.Millisecond),
			EnvelopeJSON: []byte(`{"seq":` + string(rune('0'+i)) + `}`),
		}); err != nil {
			t.Fatalf("AppendMessage[%d]: %v", i, err)
		}
	}
	rows, err := ListMessagesAfterSeq(context.Background(), db, ListMessagesAfterSeqParams{
		SessionID: sessionID, AfterSeq: -1, Limit: 10,
	})
	if err != nil {
		t.Fatalf("ListMessagesAfterSeq: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %d, want 4", len(rows))
	}
	if rows[0].EventType != EventSessionStarted {
		t.Fatalf("first row type = %q", rows[0].EventType)
	}
}

func TestAppendMessageRejectsInvalidEventType(t *testing.T) {
	db, sessionID := newMessagesDB(t)
	if err := AppendMessage(context.Background(), db, AppendMessageParams{
		SessionID:    sessionID,
		Seq:          0,
		EventType:    "mystery",
		TS:           time.Now(),
		EnvelopeJSON: []byte(`{}`),
	}); err == nil {
		t.Fatal("AppendMessage accepted unknown event_type")
	}
}

func TestAppendMessageEnforcesUniqueSeq(t *testing.T) {
	db, sessionID := newMessagesDB(t)
	params := AppendMessageParams{
		SessionID:    sessionID,
		Seq:          0,
		EventType:    EventSessionStarted,
		TS:           time.Now(),
		EnvelopeJSON: []byte(`{}`),
	}
	if err := AppendMessage(context.Background(), db, params); err != nil {
		t.Fatalf("first AppendMessage: %v", err)
	}
	if err := AppendMessage(context.Background(), db, params); err == nil {
		t.Fatal("duplicate seq accepted")
	}
}

func TestListMessagesAfterSeqFiltering(t *testing.T) {
	db, sessionID := newMessagesDB(t)
	ts := time.Now().UTC()
	for i := 0; i < 5; i++ {
		if err := AppendMessage(context.Background(), db, AppendMessageParams{
			SessionID:    sessionID,
			Seq:          int64(i),
			EventType:    EventMessage,
			TS:           ts,
			EnvelopeJSON: []byte(`{}`),
		}); err != nil {
			t.Fatalf("AppendMessage[%d]: %v", i, err)
		}
	}
	got, err := ListMessagesAfterSeq(context.Background(), db, ListMessagesAfterSeqParams{
		SessionID: sessionID, AfterSeq: 2, Limit: 100,
	})
	if err != nil {
		t.Fatalf("ListMessagesAfterSeq: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d, want 2", len(got))
	}
	if got[0].Seq != 3 || got[1].Seq != 4 {
		t.Fatalf("seqs = %d/%d", got[0].Seq, got[1].Seq)
	}
}

func TestCountMessagesForSession(t *testing.T) {
	db, sessionID := newMessagesDB(t)
	for i := 0; i < 3; i++ {
		if err := AppendMessage(context.Background(), db, AppendMessageParams{
			SessionID:    sessionID,
			Seq:          int64(i),
			EventType:    EventMessage,
			TS:           time.Now(),
			EnvelopeJSON: []byte(`{}`),
		}); err != nil {
			t.Fatalf("AppendMessage[%d]: %v", i, err)
		}
	}
	n, err := CountMessagesForSession(context.Background(), db, sessionID)
	if err != nil {
		t.Fatalf("CountMessagesForSession: %v", err)
	}
	if n != 3 {
		t.Fatalf("count = %d", n)
	}
}

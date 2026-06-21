package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/envelope"
	"github.com/nocoo/meowth/daemon/internal/home"
	"github.com/nocoo/meowth/daemon/internal/store"
	"github.com/nocoo/meowth/daemon/pkg/agent"
)

func newPumpDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("MEOWTH_TEST", "1")
	t.Setenv("MEOWTH_TEST_HOME", filepath.Join(tmp, ".meowth-test"))
	h, err := home.Test()
	if err != nil {
		t.Fatalf("home.Test: %v", err)
	}
	bs, err := sql.Open(store.DriverName(), "file:"+h.DBPath)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := store.EnsureTestMarker(context.Background(), bs); err != nil {
		t.Fatalf("EnsureTestMarker: %v", err)
	}
	_ = bs.Close()
	db, err := store.Open(context.Background(), h)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	id, _ := uuid.NewV7()
	sessionID := id.String()
	if _, err := store.InsertSession(context.Background(), db, store.InsertSessionParams{
		ID: sessionID, BackendType: store.BackendClaude, DaemonPID: 1, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	// Seed seq=0 (session_started) so the pump's builder starts
	// at seq=1 to match the handler's contract.
	if err := store.AppendMessage(context.Background(), db, store.AppendMessageParams{
		SessionID: sessionID, Seq: 0, EventType: store.EventSessionStarted,
		TS: time.Now().UTC(), EnvelopeJSON: []byte(`{"v":1,"seq":0}`),
	}); err != nil {
		t.Fatalf("seed session_started: %v", err)
	}
	return db, sessionID
}

// scriptedSession returns a real *agent.Session that emits the
// given messages then a Result. Used to drive the pump without
// spinning up testbackend.
func scriptedSession(msgs []agent.Message, r agent.Result) *agent.Session {
	mc := make(chan agent.Message, len(msgs)+1)
	rc := make(chan agent.Result, 1)
	go func() {
		defer close(mc)
		defer close(rc)
		for _, m := range msgs {
			mc <- m
		}
		rc <- r
	}()
	return &agent.Session{Messages: mc, Result: rc}
}

func runPump(t *testing.T, db *sql.DB, sessionID string, sess *agent.Session, hbInterval time.Duration) (*httptest.ResponseRecorder, pumpResult) {
	t.Helper()
	rr := httptest.NewRecorder()
	res := pumpAgentSession(context.Background(), pumpConfig{
		DB:                db,
		SessionID:         sessionID,
		BackendType:       "claude",
		Session:           sess,
		Writer:            rr,
		Flusher:           rr,
		Logger:            slog.New(slog.NewJSONHandler(io.Discard, nil)),
		HeartbeatInterval: hbInterval,
		Now:               time.Now,
	})
	return rr, res
}

func TestPumpHappyPathEmitsSessionEndedAndUpdatesRow(t *testing.T) {
	db, id := newPumpDB(t)
	sess := scriptedSession(
		[]agent.Message{
			{Type: agent.MessageText, Content: "hello"},
			{Type: agent.MessageStatus, Status: "in_progress", SessionID: "backend-1"},
		},
		agent.Result{
			Status:     "completed",
			Output:     "hello",
			DurationMs: 50,
			SessionID:  "backend-1",
			Usage: map[string]agent.TokenUsage{
				"claude-3-5": {InputTokens: 12, OutputTokens: 7},
			},
		},
	)
	rr, res := runPump(t, db, id, sess, time.Hour)
	if res.Status != "completed" || res.PersistErr != nil {
		t.Fatalf("pump result = %+v", res)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"type":"session_ended"`)) {
		t.Fatalf("body missing session_ended: %s", rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"type":"message"`)) {
		t.Fatalf("body missing message: %s", rr.Body.String())
	}
	// Row updated.
	s, err := store.GetSession(context.Background(), db, id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if s.Status != store.SessionStatusCompleted {
		t.Fatalf("status = %q, want completed", s.Status)
	}
	if s.BackendSessionID != "backend-1" {
		t.Fatalf("backend_session_id = %q", s.BackendSessionID)
	}
	// usage_json non-empty.
	if len(s.UsageJSON) == 0 || !bytes.Contains(s.UsageJSON, []byte("input_tokens")) {
		t.Fatalf("usage_json: %q", s.UsageJSON)
	}
}

func TestPumpPersistFailureClosesStreamWithoutSessionEnded(t *testing.T) {
	db, id := newPumpDB(t)
	// Close the DB BEFORE running the pump so AppendMessage
	// returns an error immediately. The pump must abort the
	// stream and NOT emit session_ended.
	_ = db.Close()
	sess := scriptedSession(
		[]agent.Message{
			{Type: agent.MessageText, Content: "hello"},
		},
		agent.Result{Status: "completed"},
	)
	rr, res := runPump(t, db, id, sess, time.Hour)
	if res.PersistErr == nil {
		t.Fatal("expected PersistErr to be set")
	}
	if res.Status != string(store.SessionStatusFailed) {
		t.Fatalf("status = %q, want failed", res.Status)
	}
	// The response body must NOT include session_ended per
	// docs/architecture/03 §7.2 "do not emit any further envelopes,
	// including session_ended".
	if bytes.Contains(rr.Body.Bytes(), []byte(`"type":"session_ended"`)) {
		t.Fatalf("session_ended leaked after persist failure: %s", rr.Body.String())
	}
}

func TestPumpHeartbeatFiresWhenIdle(t *testing.T) {
	db, id := newPumpDB(t)
	// Source that never emits a message before the heartbeat
	// interval triggers. Use a small interval so the test runs
	// fast (50ms).
	mc := make(chan agent.Message)
	rc := make(chan agent.Result, 1)
	go func() {
		time.Sleep(200 * time.Millisecond)
		rc <- agent.Result{Status: "completed"}
		close(mc)
		close(rc)
	}()
	rr, res := runPump(t, db, id, &agent.Session{Messages: mc, Result: rc}, 50*time.Millisecond)
	if res.Status != "completed" {
		t.Fatalf("status = %q", res.Status)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"type":"heartbeat"`)) {
		t.Fatalf("body missing heartbeat: %s", rr.Body.String())
	}
}

func TestPumpRespectsCancelledContextWithCancelledResult(t *testing.T) {
	db, id := newPumpDB(t)
	mc := make(chan agent.Message)
	rc := make(chan agent.Result, 1)
	go func() {
		// Sleep briefly then deliver a cancelled Result.
		time.Sleep(100 * time.Millisecond)
		rc <- agent.Result{Status: "cancelled", Error: "context canceled"}
		close(mc)
		close(rc)
	}()
	rr := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	res := pumpAgentSession(ctx, pumpConfig{
		DB:                db,
		SessionID:         id,
		BackendType:       "claude",
		Session:           &agent.Session{Messages: mc, Result: rc},
		Writer:            rr,
		Flusher:           rr,
		Logger:            slog.New(slog.NewJSONHandler(io.Discard, nil)),
		HeartbeatInterval: time.Hour,
		Now:               time.Now,
	})
	if res.Status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", res.Status)
	}
	// session_ended carries status=cancelled.
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"status":"cancelled"`)) {
		t.Fatalf("body lacks cancelled status: %s", rr.Body.String())
	}
}

// TestPumpShutdownOverridesStatusToAborted covers docs/
// architecture/02 §8.1: when the pump's ctx fires because daemon
// shutdown invoked CancelAll (not user POST /cancel), the
// terminal envelope AND the persisted session row must show
// `aborted`, not `cancelled`. The fake backend in this test
// returns `cancelled` (its natural cancel response); the
// IsShutdown hook must override the terminal status.
func TestPumpShutdownOverridesStatusToAborted(t *testing.T) {
	db, id := newPumpDB(t)
	mc := make(chan agent.Message)
	rc := make(chan agent.Result, 1)
	go func() {
		// Wait for ctx to fire upstream, then deliver a
		// cancelled Result (typical of a fake/real backend
		// honoring ctx.Done).
		time.Sleep(100 * time.Millisecond)
		rc <- agent.Result{Status: "cancelled", Error: "context canceled"}
		close(mc)
		close(rc)
	}()
	rr := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())
	shutdownFlag := false
	go func() {
		time.Sleep(30 * time.Millisecond)
		// Mirror what cancelRegistry.CancelAll does: mark
		// shutdown THEN call the cancel func.
		shutdownFlag = true
		cancel()
	}()
	res := pumpAgentSession(ctx, pumpConfig{
		DB:                db,
		SessionID:         id,
		BackendType:       "claude",
		Session:           &agent.Session{Messages: mc, Result: rc},
		Writer:            rr,
		Flusher:           rr,
		Logger:            slog.New(slog.NewJSONHandler(io.Discard, nil)),
		HeartbeatInterval: time.Hour,
		Now:               time.Now,
		IsShutdown:        func() bool { return shutdownFlag },
	})
	if res.Status != "aborted" {
		t.Fatalf("pumpResult.Status = %q, want aborted", res.Status)
	}
	// Wire body: session_ended.payload.status == "aborted".
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"status":"aborted"`)) {
		t.Fatalf("body lacks aborted status: %s", rr.Body.String())
	}
	if bytes.Contains(rr.Body.Bytes(), []byte(`"status":"cancelled"`)) {
		t.Fatalf("body still carries cancelled: %s", rr.Body.String())
	}
	// SQLite row carries aborted too.
	row, err := store.GetSession(context.Background(), db, id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if row.Status != store.SessionStatusAborted {
		t.Fatalf("row.Status = %q, want aborted", row.Status)
	}
	// Last persisted envelope should also be aborted.
	rows, err := store.ListMessagesAfterSeq(context.Background(), db, store.ListMessagesAfterSeqParams{
		SessionID: id, AfterSeq: -1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("ListMessagesAfterSeq: %v", err)
	}
	last := rows[len(rows)-1]
	if last.EventType != store.EventSessionEnded {
		t.Fatalf("last persisted event = %q, want session_ended", last.EventType)
	}
	if !bytes.Contains(last.EnvelopeJSON, []byte(`"status":"aborted"`)) {
		t.Fatalf("persisted session_ended lacks aborted: %s", string(last.EnvelopeJSON))
	}
}

func TestPumpUserCancelKeepsCancelledStatus(t *testing.T) {
	// docs/architecture/02 §8.1: user-initiated cancel
	// (IsShutdown=false) must keep `cancelled`.
	db, id := newPumpDB(t)
	mc := make(chan agent.Message)
	rc := make(chan agent.Result, 1)
	go func() {
		time.Sleep(100 * time.Millisecond)
		rc <- agent.Result{Status: "cancelled", Error: "user cancel"}
		close(mc)
		close(rc)
	}()
	rr := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	res := pumpAgentSession(ctx, pumpConfig{
		DB:                db,
		SessionID:         id,
		BackendType:       "claude",
		Session:           &agent.Session{Messages: mc, Result: rc},
		Writer:            rr,
		Flusher:           rr,
		Logger:            slog.New(slog.NewJSONHandler(io.Discard, nil)),
		HeartbeatInterval: time.Hour,
		Now:               time.Now,
		IsShutdown:        func() bool { return false },
	})
	if res.Status != "cancelled" {
		t.Fatalf("status = %q, want cancelled (user cancel)", res.Status)
	}
	row, _ := store.GetSession(context.Background(), db, id)
	if row.Status != store.SessionStatusCancelled {
		t.Fatalf("row status = %q, want cancelled", row.Status)
	}
}

func TestPumpEmitsMessageEventInWireOrder(t *testing.T) {
	db, id := newPumpDB(t)
	sess := scriptedSession(
		[]agent.Message{
			{Type: agent.MessageText, Content: "one"},
			{Type: agent.MessageText, Content: "two"},
		},
		agent.Result{Status: "completed"},
	)
	rr, _ := runPump(t, db, id, sess, time.Hour)
	body := rr.Body.String()
	idxOne := bytes.Index([]byte(body), []byte(`"one"`))
	idxTwo := bytes.Index([]byte(body), []byte(`"two"`))
	if idxOne == -1 || idxTwo == -1 || idxOne >= idxTwo {
		t.Fatalf("wire order broken: idxOne=%d idxTwo=%d body=%s", idxOne, idxTwo, body)
	}
}

func TestPumpPersistsAllEnvelopesToSQLite(t *testing.T) {
	db, id := newPumpDB(t)
	sess := scriptedSession(
		[]agent.Message{
			{Type: agent.MessageText, Content: "a"},
			{Type: agent.MessageText, Content: "b"},
			{Type: agent.MessageText, Content: "c"},
		},
		agent.Result{Status: "completed"},
	)
	_, _ = runPump(t, db, id, sess, time.Hour)
	rows, err := store.ListMessagesAfterSeq(context.Background(), db, store.ListMessagesAfterSeqParams{
		SessionID: id, AfterSeq: -1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("ListMessagesAfterSeq: %v", err)
	}
	// seq=0 session_started (seeded) + 3 message + 1 session_ended = 5.
	if len(rows) != 5 {
		t.Fatalf("rows = %d, want 5", len(rows))
	}
	// Last row must be session_ended.
	if rows[len(rows)-1].EventType != store.EventSessionEnded {
		t.Fatalf("last row type = %q", rows[len(rows)-1].EventType)
	}
}

// TestDrainRemainingMessagesPersistFailureSurfacesError exercises
// the reviewer-cited Result-first-then-drain path: the pump must
// route a drain-time persist failure through abortStream so the
// docs/architecture/03 §7.2 "no session_ended after persist
// failure" rule applies even when Result arrived first.
func TestDrainRemainingMessagesPersistFailureSurfacesError(t *testing.T) {
	db, sessionID := newPumpDB(t)
	// Close DB BEFORE drain runs so the first persistAndWrite
	// returns an error. Build a buffered Messages chan with two
	// entries; drainRemainingMessages should hit the closed DB,
	// return error, and NOT continue to the second message.
	_ = db.Close()

	mc := make(chan agent.Message, 2)
	mc <- agent.Message{Type: agent.MessageText, Content: "drain-1"}
	mc <- agent.Message{Type: agent.MessageText, Content: "drain-2"}
	close(mc)

	cfg := pumpConfig{
		DB:        db,
		SessionID: sessionID,
		Writer:    httptest.NewRecorder(),
		Flusher:   httptest.NewRecorder(),
		Logger:    slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Now:       time.Now,
		Session:   &agent.Session{Messages: mc, Result: make(chan agent.Result)},
	}
	builder := envelope.NewBuilder(sessionID)
	// Builder is at seq=0; the drain helper expects seq=1+, so
	// burn one envelope to advance the cursor (matches the
	// production pump's prime).
	_, _ = builder.SessionStarted(time.Now(), envelope.SessionStartedPayload{})
	var bsID string
	last := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	err := drainRemainingMessages(ctx, cfg, builder, &last, &bsID, cfg.Logger)
	if err == nil {
		t.Fatal("drainRemainingMessages should return error when persist fails")
	}
}

// TestPumpResultFirstWithBufferedMessagesAndPersistFailureNoSessionEnded
// proves the integrated flow: Result arrives first, the drain
// loop fails to persist its first buffered message, and the pump
// returns via abortStream (Status=failed, PersistErr non-nil, no
// session_ended written to the wire).
func TestPumpResultFirstWithBufferedMessagesAndPersistFailureNoSessionEnded(t *testing.T) {
	db, id := newPumpDB(t)
	// Buffer message + Result before closing DB; the pump select
	// is racy but with buffered channels of size 1 each, runtime
	// may choose either. To force the drain branch, send the
	// Result before the message and ensure Messages has a queued
	// entry by the time select fires.
	mc := make(chan agent.Message, 4)
	mc <- agent.Message{Type: agent.MessageText, Content: "stray"}
	// We do NOT close Messages — Result wins the select once it
	// becomes ready.
	rc := make(chan agent.Result, 1)
	rc <- agent.Result{Status: "completed"}

	_ = db.Close()

	rr := httptest.NewRecorder()
	res := pumpAgentSession(context.Background(), pumpConfig{
		DB:                db,
		SessionID:         id,
		BackendType:       "claude",
		Session:           &agent.Session{Messages: mc, Result: rc},
		Writer:            rr,
		Flusher:           rr,
		Logger:            slog.New(slog.NewJSONHandler(io.Discard, nil)),
		HeartbeatInterval: time.Hour,
		Now:               time.Now,
	})
	// Either path is acceptable here: if the pump took the
	// message branch first, it aborts on the message persist; if
	// it took the result branch first, drain fails on the
	// buffered message. Both must return Status=failed AND must
	// NOT write session_ended.
	if res.Status != string(store.SessionStatusFailed) {
		t.Fatalf("status = %q, want failed", res.Status)
	}
	if res.PersistErr == nil {
		t.Fatal("PersistErr should be set")
	}
	if bytes.Contains(rr.Body.Bytes(), []byte(`"type":"session_ended"`)) {
		t.Fatalf("session_ended leaked: %s", rr.Body.String())
	}
}

// envelopeBuilderForTest is kept for future test scaffolding; the
// drain test uses envelope.NewBuilder directly so this helper has
// no callers. Removing it would require pruning the unused
// `envelope` import elsewhere; the indirection keeps the rest of
// the file stable.
var _ = envelopeBuilderForTest

func envelopeBuilderForTest(sessionID string) any {
	b := envelope.NewBuilder(sessionID)
	_, _ = b.SessionStarted(time.Now(), envelope.SessionStartedPayload{})
	return b
}

// silenceUnusedImport keeps the json import referenced even if
// future edits drop the body-shape assertion above.
var _ = json.NewDecoder

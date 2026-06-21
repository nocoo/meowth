package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nocoo/meowth/daemon/internal/home"
)

func newSessionsDB(t *testing.T) *sql.DB {
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
	return db
}

func mustUUID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	return id.String()
}

func TestInsertSessionAndGet(t *testing.T) {
	db := newSessionsDB(t)
	id := mustUUID(t)
	got, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID:          id,
		BackendType: BackendClaude,
		ThreadName:  "test-thread",
		Model:       "claude-3-5",
		DaemonPID:   1234,
		StartedAt:   time.Now(),
	})
	if err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	if got.Status != SessionStatusRunning {
		t.Fatalf("status = %q", got.Status)
	}
	fetched, err := GetSession(context.Background(), db, id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if fetched.BackendType != BackendClaude || fetched.ThreadName != "test-thread" {
		t.Fatalf("fetched mismatch: %+v", fetched)
	}
}

func TestInsertSessionRejectsInvalidBackend(t *testing.T) {
	db := newSessionsDB(t)
	_, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID:          mustUUID(t),
		BackendType: BackendType("godot"),
		StartedAt:   time.Now(),
	})
	if err == nil {
		t.Fatal("InsertSession accepted invalid backend type")
	}
}

func TestGetSessionUnknownReturnsErrSessionNotFound(t *testing.T) {
	db := newSessionsDB(t)
	_, err := GetSession(context.Background(), db, "01900000-0000-7000-8000-000000000000")
	if err != ErrSessionNotFound {
		t.Fatalf("err = %v, want ErrSessionNotFound", err)
	}
}

func TestUpdateSessionEndedTransitionsTerminalStatus(t *testing.T) {
	db := newSessionsDB(t)
	id := mustUUID(t)
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: id, BackendType: BackendClaude, DaemonPID: 1, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
		ID:         id,
		Status:     SessionStatusCompleted,
		EndedAt:    time.Now(),
		DurationMS: 1000,
		UsageJSON:  []byte(`{"claude":{"input_tokens":1,"output_tokens":2}}`),
	}); err != nil {
		t.Fatalf("UpdateSessionEnded: %v", err)
	}
	got, err := GetSession(context.Background(), db, id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.Status != SessionStatusCompleted || got.DurationMS != 1000 {
		t.Fatalf("update mismatch: %+v", got)
	}
	if !strings.Contains(string(got.UsageJSON), "input_tokens") {
		t.Fatalf("usage_json not roundtripped: %q", string(got.UsageJSON))
	}
}

func TestUpdateSessionEndedRejectsRunningStatus(t *testing.T) {
	db := newSessionsDB(t)
	id := mustUUID(t)
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: id, BackendType: BackendClaude, DaemonPID: 1, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
		ID:     id,
		Status: SessionStatusRunning,
	}); err == nil {
		t.Fatal("UpdateSessionEnded accepted running status")
	}
}

func TestUpdateSessionBackendSessionID(t *testing.T) {
	db := newSessionsDB(t)
	id := mustUUID(t)
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: id, BackendType: BackendClaude, DaemonPID: 1, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	if err := UpdateSessionBackendSessionID(context.Background(), db, id, "upstream-99"); err != nil {
		t.Fatalf("UpdateSessionBackendSessionID: %v", err)
	}
	got, _ := GetSession(context.Background(), db, id)
	if got.BackendSessionID != "upstream-99" {
		t.Fatalf("backend_session_id = %q", got.BackendSessionID)
	}
}

func TestListSessionsOrderedByStartedAtDesc(t *testing.T) {
	db := newSessionsDB(t)
	now := time.Now().UTC()
	ids := make([]string, 3)
	for i := range ids {
		ids[i] = mustUUID(t)
		if _, err := InsertSession(context.Background(), db, InsertSessionParams{
			ID:          ids[i],
			BackendType: BackendClaude,
			DaemonPID:   1,
			StartedAt:   now.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatalf("InsertSession[%d]: %v", i, err)
		}
	}
	rows, err := ListSessions(context.Background(), db, ListSessionsParams{Limit: 10})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d", len(rows))
	}
	// Most recently started (last id) should be first.
	if rows[0].ID != ids[2] {
		t.Fatalf("first row id = %q, want %q", rows[0].ID, ids[2])
	}
}

func TestListSessionsFiltersByStatus(t *testing.T) {
	db := newSessionsDB(t)
	now := time.Now().UTC()
	idA, idB := mustUUID(t), mustUUID(t)
	for _, id := range []string{idA, idB} {
		if _, err := InsertSession(context.Background(), db, InsertSessionParams{
			ID: id, BackendType: BackendClaude, DaemonPID: 1, StartedAt: now,
		}); err != nil {
			t.Fatalf("InsertSession: %v", err)
		}
	}
	if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
		ID: idA, Status: SessionStatusCompleted, EndedAt: now,
	}); err != nil {
		t.Fatalf("UpdateSessionEnded: %v", err)
	}
	got, err := ListSessions(context.Background(), db, ListSessionsParams{
		Limit:    10,
		Statuses: []SessionStatus{SessionStatusRunning},
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(got) != 1 || got[0].ID != idB {
		t.Fatalf("filter returned %+v", got)
	}
}

func TestMarkRunningSessionsAborted(t *testing.T) {
	db := newSessionsDB(t)
	idA, idB := mustUUID(t), mustUUID(t)
	now := time.Now().UTC()
	for _, id := range []string{idA, idB} {
		if _, err := InsertSession(context.Background(), db, InsertSessionParams{
			ID: id, BackendType: BackendClaude, DaemonPID: 1, StartedAt: now,
		}); err != nil {
			t.Fatalf("InsertSession: %v", err)
		}
	}
	if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
		ID: idA, Status: SessionStatusCompleted, EndedAt: now,
	}); err != nil {
		t.Fatalf("UpdateSessionEnded: %v", err)
	}
	n, err := MarkRunningSessionsAborted(context.Background(), db, now)
	if err != nil {
		t.Fatalf("MarkRunningSessionsAborted: %v", err)
	}
	if n != 1 {
		t.Fatalf("rows touched = %d, want 1", n)
	}
	gotB, _ := GetSession(context.Background(), db, idB)
	if gotB.Status != SessionStatusAborted {
		t.Fatalf("idB status = %q, want aborted", gotB.Status)
	}
	if gotB.Error == "" {
		t.Fatal("error should be set on abort")
	}
}

// TestListSessionsAppliesLimitAfterStatusFilter is the reviewer-
// cited regression test for the original "limit-then-filter" bug:
// when status=running but the most recent rows are completed, the
// caller MUST still receive the running rows up to limit.
//
// Setup: insert 5 completed sessions (most recent) followed by 1
// running session (oldest). Query status=running limit=3 — must
// return that 1 running row, not [] (which is what the in-Go
// filter would have produced because the SQL had already cut to
// the top-3 completed by started_at DESC).
func TestListSessionsAppliesLimitAfterStatusFilter(t *testing.T) {
	db := newSessionsDB(t)
	now := time.Now().UTC()
	runningID := mustUUID(t)
	// Oldest row is the running one. Insert it first so its
	// started_at is the smallest.
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: runningID, BackendType: BackendClaude, DaemonPID: 1,
		StartedAt: now.Add(-10 * time.Second),
	}); err != nil {
		t.Fatalf("InsertSession running: %v", err)
	}
	// 5 newer completed sessions on top.
	for i := 0; i < 5; i++ {
		id := mustUUID(t)
		if _, err := InsertSession(context.Background(), db, InsertSessionParams{
			ID: id, BackendType: BackendClaude, DaemonPID: 1,
			StartedAt: now.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatalf("InsertSession completed[%d]: %v", i, err)
		}
		if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
			ID: id, Status: SessionStatusCompleted, EndedAt: now,
		}); err != nil {
			t.Fatalf("UpdateSessionEnded: %v", err)
		}
	}

	got, err := ListSessions(context.Background(), db, ListSessionsParams{
		Limit:    3,
		Statuses: []SessionStatus{SessionStatusRunning},
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("running rows = %d, want 1 (limit-after-filter regression)", len(got))
	}
	if got[0].ID != runningID {
		t.Fatalf("running id = %q, want %q", got[0].ID, runningID)
	}
}

// TestListSessionsByStatusCSV exercises a multi-value status
// filter combined with limit; verifies sqlc's slice expansion.
func TestListSessionsByStatusCSV(t *testing.T) {
	db := newSessionsDB(t)
	now := time.Now().UTC()
	// 2 completed + 2 failed + 1 running.
	type seed struct {
		id     string
		status SessionStatus
	}
	seeds := []seed{
		{mustUUID(t), SessionStatusCompleted},
		{mustUUID(t), SessionStatusCompleted},
		{mustUUID(t), SessionStatusFailed},
		{mustUUID(t), SessionStatusFailed},
		{mustUUID(t), SessionStatusRunning},
	}
	for i, s := range seeds {
		if _, err := InsertSession(context.Background(), db, InsertSessionParams{
			ID: s.id, BackendType: BackendClaude, DaemonPID: 1,
			StartedAt: now.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatalf("seed[%d]: %v", i, err)
		}
		if s.status != SessionStatusRunning {
			if err := UpdateSessionEnded(context.Background(), db, UpdateSessionEndedParams{
				ID: s.id, Status: s.status, EndedAt: now,
			}); err != nil {
				t.Fatalf("UpdateSessionEnded[%d]: %v", i, err)
			}
		}
	}
	got, err := ListSessions(context.Background(), db, ListSessionsParams{
		Limit:    10,
		Statuses: []SessionStatus{SessionStatusCompleted, SessionStatusFailed},
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("rows = %d, want 4 (CSV filter)", len(got))
	}
	for _, r := range got {
		if r.Status != SessionStatusCompleted && r.Status != SessionStatusFailed {
			t.Fatalf("row status = %q, not in CSV filter", r.Status)
		}
	}
}

// TestListSessionsBeforeCombinedWithStatus verifies the status +
// before combination uses the new SQL query (not in-Go filter).
func TestListSessionsBeforeCombinedWithStatus(t *testing.T) {
	db := newSessionsDB(t)
	now := time.Now().UTC()
	idOldRunning := mustUUID(t)
	idNewRunning := mustUUID(t)
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: idOldRunning, BackendType: BackendClaude, DaemonPID: 1,
		StartedAt: now.Add(-1 * time.Hour),
	}); err != nil {
		t.Fatalf("InsertSession old: %v", err)
	}
	if _, err := InsertSession(context.Background(), db, InsertSessionParams{
		ID: idNewRunning, BackendType: BackendClaude, DaemonPID: 1,
		StartedAt: now,
	}); err != nil {
		t.Fatalf("InsertSession new: %v", err)
	}
	got, err := ListSessions(context.Background(), db, ListSessionsParams{
		Limit:    10,
		Statuses: []SessionStatus{SessionStatusRunning},
		Before:   now.Add(-30 * time.Minute),
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("rows = %d, want 1", len(got))
	}
	if got[0].ID != idOldRunning {
		t.Fatalf("got %q, want old running %q", got[0].ID, idOldRunning)
	}
}

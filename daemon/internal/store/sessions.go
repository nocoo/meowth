// Sessions table wrapper per docs/architecture/03 §6.
//
// The store package owns SQL <-> Go translation; callers receive
// fully-typed Session values and pass enum-typed status / backend.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/nocoo/meowth/daemon/internal/store/gen"
)

// SessionStatus is the docs/architecture/03 §6.2 status enum.
type SessionStatus string

const (
	SessionStatusRunning   SessionStatus = "running"
	SessionStatusCompleted SessionStatus = "completed"
	SessionStatusFailed    SessionStatus = "failed"
	SessionStatusAborted   SessionStatus = "aborted"
	SessionStatusTimeout   SessionStatus = "timeout"
	SessionStatusCancelled SessionStatus = "cancelled"
)

// IsTerminal reports whether status is one of the docs/architecture/03
// §6.2 terminal states (anything other than running).
func (s SessionStatus) IsTerminal() bool {
	return s != SessionStatusRunning
}

// BackendType is the trimmed 5-backend whitelist per docs/architecture/01 §4.
type BackendType string

const (
	BackendClaude  BackendType = "claude"
	BackendCopilot BackendType = "copilot"
	BackendCodex   BackendType = "codex"
	BackendHermes  BackendType = "hermes"
	BackendPi      BackendType = "pi"
)

// SupportedBackendTypes is the canonical list. Order matters — GET
// /v1/agents enumerates in this order per docs/architecture/02 §6.1.
var SupportedBackendTypes = []BackendType{
	BackendClaude,
	BackendCopilot,
	BackendCodex,
	BackendHermes,
	BackendPi,
}

// IsValid reports whether t is in the trimmed whitelist.
func (t BackendType) IsValid() bool {
	for _, v := range SupportedBackendTypes {
		if v == t {
			return true
		}
	}
	return false
}

// Session is the in-memory projection of a sessions row.
type Session struct {
	ID               string
	BackendType      BackendType
	BackendSessionID string
	Status           SessionStatus
	StartedAt        time.Time
	EndedAt          time.Time // zero when status == running
	ThreadName       string
	Model            string
	DaemonPID        int
	Error            string
	DurationMS       int64
	UsageJSON        []byte // raw bytes; empty when no usage recorded
}

// InsertSessionParams carries the fields exec sets on session start.
// status is implicitly "running"; ended_at / error / duration_ms /
// usage_json are left at their column defaults and set later by
// UpdateSessionEnded.
type InsertSessionParams struct {
	ID               string
	BackendType      BackendType
	BackendSessionID string
	ThreadName       string
	Model            string
	DaemonPID        int
	StartedAt        time.Time
}

// InsertSession writes a new running session row.
func InsertSession(ctx context.Context, db *sql.DB, p InsertSessionParams) (*Session, error) {
	if !p.BackendType.IsValid() {
		return nil, fmt.Errorf("store: invalid backend_type %q", p.BackendType)
	}
	if p.ID == "" {
		return nil, errors.New("store: session id is required")
	}
	started := p.StartedAt.UTC().Truncate(time.Second)
	if err := gen.New(db).InsertSession(ctx, gen.InsertSessionParams{
		ID:               p.ID,
		BackendType:      string(p.BackendType),
		BackendSessionID: p.BackendSessionID,
		Status:           string(SessionStatusRunning),
		StartedAt:        started.Unix(),
		ThreadName:       p.ThreadName,
		Model:            p.Model,
		DaemonPid:        int64(p.DaemonPID),
	}); err != nil {
		return nil, fmt.Errorf("store: insert session: %w", err)
	}
	return &Session{
		ID:               p.ID,
		BackendType:      p.BackendType,
		BackendSessionID: p.BackendSessionID,
		Status:           SessionStatusRunning,
		StartedAt:        started,
		ThreadName:       p.ThreadName,
		Model:            p.Model,
		DaemonPID:        p.DaemonPID,
	}, nil
}

// UpdateSessionBackendSessionID stores the first non-empty
// backend_session_id observed in upstream messages.
func UpdateSessionBackendSessionID(ctx context.Context, db *sql.DB, id, backendSessionID string) error {
	if err := gen.New(db).UpdateSessionBackendSessionID(ctx, gen.UpdateSessionBackendSessionIDParams{
		BackendSessionID: backendSessionID,
		ID:               id,
	}); err != nil {
		return fmt.Errorf("store: update session backend_session_id: %w", err)
	}
	return nil
}

// UpdateSessionEndedParams collects the terminal fields written when
// a session moves out of running.
type UpdateSessionEndedParams struct {
	ID         string
	Status     SessionStatus
	EndedAt    time.Time
	Error      string
	DurationMS int64
	UsageJSON  []byte
}

// UpdateSessionEnded transitions a session to a terminal status.
func UpdateSessionEnded(ctx context.Context, db *sql.DB, p UpdateSessionEndedParams) error {
	if !p.Status.IsTerminal() {
		return fmt.Errorf("store: cannot mark session ended with status %q", p.Status)
	}
	if p.UsageJSON == nil {
		p.UsageJSON = []byte{}
	}
	if err := gen.New(db).UpdateSessionEnded(ctx, gen.UpdateSessionEndedParams{
		Status:     string(p.Status),
		EndedAt:    sql.NullInt64{Int64: p.EndedAt.UTC().Unix(), Valid: true},
		Error:      p.Error,
		DurationMs: p.DurationMS,
		UsageJson:  p.UsageJSON,
		ID:         p.ID,
	}); err != nil {
		return fmt.Errorf("store: update session ended: %w", err)
	}
	return nil
}

// GetSession returns a single session row.
func GetSession(ctx context.Context, db *sql.DB, id string) (*Session, error) {
	row, err := gen.New(db).GetSession(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("store: get session: %w", err)
	}
	return rowToSession(row), nil
}

// ErrSessionNotFound is returned by GetSession when the id is unknown.
var ErrSessionNotFound = errors.New("store: session not found")

// ListSessionsParams collects the query parameters docs/architecture/02 §6.2
// exposes (status filter / limit / before).
type ListSessionsParams struct {
	Statuses []SessionStatus // empty means "no filter"
	Limit    int             // 1..200; default 50 enforced by caller
	Before   time.Time       // zero means "no filter"
}

// ListSessions runs the §6.2 query in descending started_at order.
// Status filtering and the LIMIT apply in the same SQL statement so
// `status=running&limit=50` does not get "newest 50 then filter".
func ListSessions(ctx context.Context, db *sql.DB, p ListSessionsParams) ([]Session, error) {
	q := gen.New(db)
	statuses := statusFilterValues(p.Statuses)
	hasStatusFilter := len(statuses) > 0
	hasBefore := !p.Before.IsZero()
	var rows []gen.Session
	var err error
	switch {
	case hasStatusFilter && hasBefore:
		rows, err = q.ListSessionsByStatusBeforeOrderedByStartedAt(ctx, gen.ListSessionsByStatusBeforeOrderedByStartedAtParams{
			Statuses:  statuses,
			StartedAt: p.Before.UTC().Unix(),
			Limit:     int64(p.Limit),
		})
	case hasStatusFilter:
		rows, err = q.ListSessionsByStatusOrderedByStartedAt(ctx, gen.ListSessionsByStatusOrderedByStartedAtParams{
			Statuses: statuses,
			Limit:    int64(p.Limit),
		})
	case hasBefore:
		rows, err = q.ListSessionsBeforeOrderedByStartedAt(ctx, gen.ListSessionsBeforeOrderedByStartedAtParams{
			StartedAt: p.Before.UTC().Unix(),
			Limit:     int64(p.Limit),
		})
	default:
		rows, err = q.ListAllSessionsOrderedByStartedAt(ctx, int64(p.Limit))
	}
	if err != nil {
		return nil, fmt.Errorf("store: list sessions: %w", err)
	}
	out := make([]Session, 0, len(rows))
	for i := range rows {
		out = append(out, *rowToSession(rows[i]))
	}
	return out, nil
}

// statusFilterValues converts a typed SessionStatus slice into a
// string slice for the sqlc-generated `IN` query. Returns nil for an
// empty input so the caller can pick the no-filter query variant.
func statusFilterValues(in []SessionStatus) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = string(s)
	}
	return out
}

// MarkRunningSessionsAborted is the docs/architecture/03 §6.3 startup
// cleanup. Returns the number of rows touched so callers can log it.
func MarkRunningSessionsAborted(ctx context.Context, db *sql.DB, now time.Time) (int64, error) {
	// gen exposes only an :exec; use a direct count beforehand so
	// callers can include the number in startup logs.
	countQuery := "SELECT COUNT(*) FROM sessions WHERE status = 'running'"
	var n int64
	if err := db.QueryRowContext(ctx, countQuery).Scan(&n); err != nil {
		return 0, fmt.Errorf("store: count running sessions: %w", err)
	}
	if n == 0 {
		return 0, nil
	}
	if err := gen.New(db).MarkRunningSessionsAborted(ctx, sql.NullInt64{Int64: now.UTC().Unix(), Valid: true}); err != nil {
		return 0, fmt.Errorf("store: mark running sessions aborted: %w", err)
	}
	return n, nil
}

func rowToSession(r gen.Session) *Session {
	s := &Session{
		ID:               r.ID,
		BackendType:      BackendType(r.BackendType),
		BackendSessionID: r.BackendSessionID,
		Status:           SessionStatus(r.Status),
		StartedAt:        time.Unix(r.StartedAt, 0).UTC(),
		ThreadName:       r.ThreadName,
		Model:            r.Model,
		DaemonPID:        int(r.DaemonPid),
		Error:            r.Error,
		DurationMS:       r.DurationMs,
		UsageJSON:        r.UsageJson,
	}
	if r.EndedAt.Valid {
		s.EndedAt = time.Unix(r.EndedAt.Int64, 0).UTC()
	}
	return s
}

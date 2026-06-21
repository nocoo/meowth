-- name: InsertSession :exec
INSERT INTO sessions (
  id, backend_type, backend_session_id, status, started_at,
  thread_name, model, daemon_pid
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetSession :one
SELECT id, backend_type, backend_session_id, status, started_at, ended_at,
       thread_name, model, daemon_pid, error, duration_ms, usage_json
FROM sessions
WHERE id = ?;

-- name: ListAllSessionsOrderedByStartedAt :many
SELECT id, backend_type, backend_session_id, status, started_at, ended_at,
       thread_name, model, daemon_pid, error, duration_ms, usage_json
FROM sessions
ORDER BY started_at DESC
LIMIT ?;

-- name: ListSessionsBeforeOrderedByStartedAt :many
SELECT id, backend_type, backend_session_id, status, started_at, ended_at,
       thread_name, model, daemon_pid, error, duration_ms, usage_json
FROM sessions
WHERE started_at < ?
ORDER BY started_at DESC
LIMIT ?;

-- name: ListSessionsByStatusOrderedByStartedAt :many
SELECT id, backend_type, backend_session_id, status, started_at, ended_at,
       thread_name, model, daemon_pid, error, duration_ms, usage_json
FROM sessions
WHERE status IN (sqlc.slice(statuses))
ORDER BY started_at DESC
LIMIT ?;

-- name: ListSessionsByStatusBeforeOrderedByStartedAt :many
SELECT id, backend_type, backend_session_id, status, started_at, ended_at,
       thread_name, model, daemon_pid, error, duration_ms, usage_json
FROM sessions
WHERE status IN (sqlc.slice(statuses)) AND started_at < ?
ORDER BY started_at DESC
LIMIT ?;

-- name: UpdateSessionBackendSessionID :exec
UPDATE sessions SET backend_session_id = ? WHERE id = ?;

-- name: UpdateSessionEnded :exec
UPDATE sessions
SET status = ?, ended_at = ?, error = ?, duration_ms = ?, usage_json = ?
WHERE id = ?;

-- name: MarkRunningSessionsAborted :exec
UPDATE sessions
SET status = 'aborted',
    ended_at = ?,
    error = CASE WHEN error = '' THEN 'daemon restarted' ELSE error END
WHERE status = 'running';

-- name: CountSessions :one
SELECT COUNT(*) FROM sessions;

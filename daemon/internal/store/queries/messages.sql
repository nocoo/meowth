-- name: InsertMessage :exec
INSERT INTO messages (session_id, seq, event_type, ts, envelope_json)
VALUES (?, ?, ?, ?, ?);

-- name: ListMessagesAfterSeq :many
SELECT seq, event_type, ts, envelope_json
FROM messages
WHERE session_id = ? AND seq > ?
ORDER BY seq
LIMIT ?;

-- name: CountMessagesForSession :one
SELECT COUNT(*) FROM messages WHERE session_id = ?;

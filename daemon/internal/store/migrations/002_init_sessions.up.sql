-- 002_init_sessions.up.sql
-- docs/architecture/03 §6: sessions table — one row per agent run.
-- The status column is the docs/architecture/03 §6.2 enum:
--   running → completed | failed | aborted | timeout | cancelled
-- backend_type is locked to the 5 trimmed agents per
-- docs/architecture/01 §4.

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  backend_type        TEXT NOT NULL,
  backend_session_id  TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  thread_name         TEXT NOT NULL DEFAULT '',
  model               TEXT NOT NULL DEFAULT '',
  daemon_pid          INTEGER NOT NULL,
  error               TEXT NOT NULL DEFAULT '',
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  usage_json          BLOB NOT NULL DEFAULT (X''),
  CHECK (backend_type IN ('claude','copilot','codex','hermes','pi')),
  CHECK (status IN ('running','completed','failed','aborted','timeout','cancelled'))
);

CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status);

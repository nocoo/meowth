-- 003_init_messages.up.sql
-- docs/architecture/03 §7: messages table — one row per NDJSON
-- envelope. envelope_json stores the FULL envelope (v/seq/ts/
-- session_id/type/payload) so follow / replay can rebuild the exact
-- byte sequence the client originally saw.

CREATE TABLE messages (
  session_id    TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  event_type    TEXT    NOT NULL,
  ts            INTEGER NOT NULL,
  envelope_json BLOB    NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (event_type IN ('session_started','message','usage','error','session_ended','heartbeat'))
);

CREATE INDEX idx_messages_session_ts ON messages(session_id, ts);

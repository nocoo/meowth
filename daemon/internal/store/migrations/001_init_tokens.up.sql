CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  token_hash  BLOB NOT NULL,
  salt        BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at  INTEGER,
  created_via TEXT NOT NULL,
  CHECK (created_via IN ('init','first_run_mint','dashboard','cli'))
);

CREATE INDEX idx_tokens_prefix ON tokens(prefix);
CREATE INDEX idx_tokens_active ON tokens(revoked_at) WHERE revoked_at IS NULL;

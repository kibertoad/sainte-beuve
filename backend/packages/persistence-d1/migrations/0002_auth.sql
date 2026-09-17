-- Sessions and API keys: who is calling, and on what authority.
--
-- Two tables with no payload column, beside `integration_tokens` and for the
-- same reason: every field is queried or shown, and the one that must not be
-- readable is a DIGEST rather than the credential itself. A dump of either table
-- carries nothing anybody can present.
--
-- The Postgres adapter carries the same two tables in the other dialect's types
-- (`persistence-postgres/src/schema.ts`), and the conformance suite is what
-- holds all three stores to one behaviour.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  -- SHA-256 of the value in the cookie, base64url. UNIQUE, because a digest
  -- addresses exactly one session: two rows for one value would make which
  -- person is calling depend on which row the planner reached first.
  token_digest TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  -- The host account the person proved, keyed the way an identity always is.
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- The read on EVERY authenticated request, so it is the index that has to exist.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_digest_idx ON sessions (token_digest);
-- Dropping every session of one person, for a directory change that must not
-- leave a cookie resolving to the old row.
CREATE INDEX IF NOT EXISTS sessions_reviewer_idx ON sessions (reviewer_id);
-- The tick's sweep: everything already expired.
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  token_digest TEXT NOT NULL,
  -- What the key is for, typed by whoever minted it: the only way to tell two apart.
  label TEXT NOT NULL,
  -- The last four characters, so a row can be matched to a secret store's entry.
  hint TEXT NOT NULL,
  -- The reviewer who minted it, when a person did. NULL for one nobody is behind.
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_digest_idx ON api_keys (token_digest);
CREATE INDEX IF NOT EXISTS api_keys_created_idx ON api_keys (created_at);

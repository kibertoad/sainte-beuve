-- Host reads kept for a while, so the screens that need one again do not ask
-- the host again. `fetched_at` is when it was read; the reader decides how old
-- is too old.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261016122011_host_snapshots/migration.sql`.
CREATE TABLE IF NOT EXISTS host_snapshots (
  org_id TEXT NOT NULL,
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, source, key)
);

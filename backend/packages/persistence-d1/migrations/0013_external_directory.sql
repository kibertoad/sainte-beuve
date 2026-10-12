-- The people, groups and memberships external systems list for an org
-- (cat-factory's directory is one), from which its reviewers and teams follow
-- while that sync is on. `key` is the source's own key for an entry; one the
-- source dropped keeps its row with a null `record` in the payload, so its `seq`
-- still refuses an older state.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012115750_external_directory/migration.sql`.
CREATE TABLE IF NOT EXISTS external_directory (
  org_id TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, source, kind, key)
);

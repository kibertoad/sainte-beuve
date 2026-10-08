-- The non-secret half of an org's integrations: where its cat-factory instance
-- is, which service and pipeline reviews are filed under. One JSON object per
-- integration, because each integration has its own fields and none of them is
-- queried. The credential beside it stays sealed in `integration_tokens`.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261008213838_parallel_kinsey_walden/migration.sql`.
CREATE TABLE IF NOT EXISTS integration_configs (
  org_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, integration_id)
);

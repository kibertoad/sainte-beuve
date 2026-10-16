-- One assessment per pull request: cat-factory's risk, impact and complexity
-- scores, kept so every list can show them. Keyed by the pull request rather
-- than a board row, because a pull request is assessed before it is on the board.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261016173928_pull_request_assessments/migration.sql`.
CREATE TABLE IF NOT EXISTS pull_request_assessments (
  org_id TEXT NOT NULL,
  pull_request_key TEXT NOT NULL,
  assessed_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, pull_request_key)
);

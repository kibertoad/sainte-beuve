-- One risk assessment per board row: the scores, the verdict and where approval
-- stands. `status` and `updated_at` are what the clock reads to drive the
-- assessments still in flight.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261013092128_risk_assessments/migration.sql`.
CREATE TABLE IF NOT EXISTS risk_assessments (
  org_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, review_id)
);

CREATE INDEX IF NOT EXISTS risk_assessments_status_idx
  ON risk_assessments (org_id, status, updated_at);

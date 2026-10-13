-- Everybody's commitments on a set of pull requests, read by key across
-- reviewers. `review_commitments_pr_idx` leads with the reviewer, so it cannot
-- serve a read that names only the key.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261013141853_commitments_by_pull_request/migration.sql`.
CREATE INDEX IF NOT EXISTS review_commitments_key_idx
  ON review_commitments (org_id, pull_request_key);

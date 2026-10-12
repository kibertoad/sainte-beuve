-- A board row is looked up by the kernel's `pullRequestKey` and its history by
-- `projectRefKey`, the keys projects and commitments already use. The host is
-- part of each: `platform/api#12` on GitHub and on GitLab are two changes, and a
-- lookup on owner, repo and number alone hands one the other's row. The path is
-- lowercased because both hosts treat it without case, so `Platform/API#12` from
-- a webhook and `platform/api#12` typed into the board are one review.
--
-- The table is rebuilt, as `0003_orgs.sql` did, so the keys are NOT NULL with
-- no default and the owner, repo and number columns they replace go. The keys
-- are backfilled from each row: the provider from its payload, `github` for a
-- payload that names none.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012113719_review_requests_keys/migration.sql`.
CREATE TABLE review_requests_keys (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  pull_request_key TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO review_requests_keys
SELECT org_id, id, status,
  repo_key || '#' || pr_number,
  repo_key,
  created_at, data
FROM (
  SELECT *,
    coalesce(json_extract(data, '$.pullRequest.provider'), 'github') || ':' || lower(pr_owner) || '/' || lower(pr_repo) AS repo_key
  FROM review_requests
);
DROP TABLE review_requests;
ALTER TABLE review_requests_keys RENAME TO review_requests;

CREATE INDEX IF NOT EXISTS review_requests_status_idx ON review_requests (org_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS review_requests_created_idx ON review_requests (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS review_requests_pr_idx ON review_requests (org_id, pull_request_key);
CREATE INDEX IF NOT EXISTS review_requests_repo_idx ON review_requests (org_id, repo_key, created_at DESC, id DESC);

-- The host a board row's pull request lives on becomes part of the key the row
-- is looked up by. `platform/api#12` on GitHub and on GitLab are two different
-- changes, and a lookup on owner, repo and number alone hands one the other's
-- row: a webhook replay would update the wrong review, and an intake would
-- refuse a new one as already tracked.
--
-- Backfilled from the payload, which has always carried the provider. The
-- DEFAULT is what SQLite requires of a NOT NULL column added to a table that has
-- rows; every write sends the provider explicitly, and the Postgres column
-- carries no default.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012104358_review_requests_provider/migration.sql`.
ALTER TABLE review_requests ADD COLUMN pr_provider TEXT NOT NULL DEFAULT 'github';
UPDATE review_requests SET pr_provider = coalesce(json_extract(data, '$.pullRequest.provider'), 'github');

DROP INDEX IF EXISTS review_requests_pr_idx;
CREATE INDEX IF NOT EXISTS review_requests_pr_idx ON review_requests (org_id, pr_provider, pr_owner, pr_repo, pr_number);

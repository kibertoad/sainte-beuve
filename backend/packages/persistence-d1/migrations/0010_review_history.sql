-- One repository's review history, newest first: the read a reviewer's
-- familiarity with a repository is counted from
-- (`WHERE org_id = ? AND pr_owner = ? AND pr_repo = ? AND created_at >= ?
-- ORDER BY created_at DESC, id DESC LIMIT ?`). `review_requests_pr_idx` finds
-- the repository but leaves its rows to be sorted; this one walks them in order
-- and stops at the cap.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012100722_wild_paibok/migration.sql`.
CREATE INDEX IF NOT EXISTS review_requests_repo_idx ON review_requests (org_id, pr_owner, pr_repo, created_at DESC, id DESC);

-- Everybody's commitments on a set of pull requests, read by key across reviewers.
-- The D1 adapter carries the same change as
-- `migrations/0017_commitments_by_pull_request.sql`.
CREATE INDEX "review_commitments_key_idx" ON "review_commitments" ("org_id","pull_request_key");

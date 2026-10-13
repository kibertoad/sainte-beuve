-- One commitment per person per pull request, held by a unique index on the
-- kernel's `pullRequestKey`, so two clicks landing together write one row.
--
-- The index cannot build over the duplicates such a race already left, so they
-- are folded first. Every key was written by `pullRequestKey`, which already
-- lowercases the path, so the keys are compared as stored. The earliest row of
-- each (org, reviewer, pull request) is kept, ties broken on the id; when it
-- holds no host request and a later row does, it takes that request over, so
-- the reviewer it names can still be withdrawn on release.
-- The later rows are then deleted.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012153000_unique_commitments/migration.sql`.
UPDATE review_commitments AS keeper
SET data = json_set(keeper.data, '$.requestedHandle', (
  SELECT json_extract(donor.data, '$.requestedHandle') FROM review_commitments AS donor
  WHERE donor.org_id = keeper.org_id AND donor.reviewer_id = keeper.reviewer_id
    AND donor.pull_request_key = keeper.pull_request_key
    AND json_extract(donor.data, '$.requestedHandle') IS NOT NULL
  ORDER BY donor.created_at, donor.id LIMIT 1
))
WHERE json_extract(keeper.data, '$.requestedHandle') IS NULL
  AND EXISTS (
    SELECT 1 FROM review_commitments AS donor
    WHERE donor.org_id = keeper.org_id AND donor.reviewer_id = keeper.reviewer_id
      AND donor.pull_request_key = keeper.pull_request_key
      AND json_extract(donor.data, '$.requestedHandle') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM review_commitments AS earlier
    WHERE earlier.org_id = keeper.org_id AND earlier.reviewer_id = keeper.reviewer_id
      AND earlier.pull_request_key = keeper.pull_request_key
      AND (earlier.created_at, earlier.id) < (keeper.created_at, keeper.id)
  );

DELETE FROM review_commitments AS later
WHERE EXISTS (
  SELECT 1 FROM review_commitments AS earlier
  WHERE earlier.org_id = later.org_id AND earlier.reviewer_id = later.reviewer_id
    AND earlier.pull_request_key = later.pull_request_key
    AND (earlier.created_at, earlier.id) < (later.created_at, later.id)
);

CREATE UNIQUE INDEX IF NOT EXISTS review_commitments_pr_idx
  ON review_commitments (org_id, reviewer_id, pull_request_key);

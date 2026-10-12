-- One commitment per person per pull request, held by a unique index on the
-- kernel's `pullRequestKey`, so two clicks landing together write one row.
--
-- The index cannot build over the duplicates such a race already left, so they
-- are folded first. Each key is lowercased as `pullRequestKey` writes it. The
-- earliest row of each (org, reviewer, pull request) is kept, ties broken on
-- the id; when it holds no host request and a later row does, it takes that
-- request over, so the reviewer it names can still be withdrawn on release.
-- The later rows are then deleted. The D1 adapter carries the same change as
-- `migrations/0015_unique_commitments.sql`.
UPDATE "review_commitments" SET "pull_request_key" = lower("pull_request_key") WHERE "pull_request_key" <> lower("pull_request_key");--> statement-breakpoint
UPDATE "review_commitments" AS "keeper"
SET "data" = jsonb_set("keeper"."data", '{requestedHandle}', (
  SELECT "donor"."data"->'requestedHandle' FROM "review_commitments" AS "donor"
  WHERE "donor"."org_id" = "keeper"."org_id" AND "donor"."reviewer_id" = "keeper"."reviewer_id"
    AND "donor"."pull_request_key" = "keeper"."pull_request_key"
    AND "donor"."data"->>'requestedHandle' IS NOT NULL
  ORDER BY "donor"."created_at", "donor"."id" LIMIT 1
))
WHERE "keeper"."data"->>'requestedHandle' IS NULL
  AND EXISTS (
    SELECT 1 FROM "review_commitments" AS "donor"
    WHERE "donor"."org_id" = "keeper"."org_id" AND "donor"."reviewer_id" = "keeper"."reviewer_id"
      AND "donor"."pull_request_key" = "keeper"."pull_request_key"
      AND "donor"."data"->>'requestedHandle' IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "review_commitments" AS "earlier"
    WHERE "earlier"."org_id" = "keeper"."org_id" AND "earlier"."reviewer_id" = "keeper"."reviewer_id"
      AND "earlier"."pull_request_key" = "keeper"."pull_request_key"
      AND ("earlier"."created_at", "earlier"."id") < ("keeper"."created_at", "keeper"."id")
  );--> statement-breakpoint
DELETE FROM "review_commitments" AS "later"
WHERE EXISTS (
  SELECT 1 FROM "review_commitments" AS "earlier"
  WHERE "earlier"."org_id" = "later"."org_id" AND "earlier"."reviewer_id" = "later"."reviewer_id"
    AND "earlier"."pull_request_key" = "later"."pull_request_key"
    AND ("earlier"."created_at", "earlier"."id") < ("later"."created_at", "later"."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "review_commitments_pr_idx" ON "review_commitments" ("org_id","reviewer_id","pull_request_key");

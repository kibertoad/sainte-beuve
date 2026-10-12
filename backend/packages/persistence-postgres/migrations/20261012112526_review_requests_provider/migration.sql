-- The host a board row's pull request lives on becomes part of the keys it is
-- looked up by: `platform/api#12` on GitHub and on GitLab are two changes, and
-- `platform/api` on each is two repositories. Added nullable, backfilled from
-- the payload (which has always carried the provider) and then tightened, so a
-- table that has rows takes it. The D1 adapter carries the same change as
-- `migrations/0011_review_requests_provider.sql`.
ALTER TABLE "review_requests" ADD COLUMN "pr_provider" text;--> statement-breakpoint
UPDATE "review_requests" SET "pr_provider" = coalesce("data"->'pullRequest'->>'provider', 'github');--> statement-breakpoint
ALTER TABLE "review_requests" ALTER COLUMN "pr_provider" SET NOT NULL;--> statement-breakpoint
DROP INDEX "review_requests_pr_idx";--> statement-breakpoint
CREATE INDEX "review_requests_pr_idx" ON "review_requests" ("org_id","pr_provider","pr_owner","pr_repo","pr_number");--> statement-breakpoint
DROP INDEX "review_requests_repo_idx";--> statement-breakpoint
CREATE INDEX "review_requests_repo_idx" ON "review_requests" ("org_id","pr_provider","pr_owner","pr_repo","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);

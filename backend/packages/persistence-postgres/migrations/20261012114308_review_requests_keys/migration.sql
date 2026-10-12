-- A board row is looked up by the kernel's `pullRequestKey` and its history by
-- `projectRefKey`, the keys projects and commitments already use: the host is
-- part of each, and the path is lowercased because both hosts treat it without
-- case. The owner, repo and number columns they replace go. The keys are added
-- nullable, backfilled from each row (the provider from its payload, `github`
-- for a payload that names none) and then tightened, so a table that has rows
-- takes them. The D1 adapter carries the same change as
-- `migrations/0012_review_requests_keys.sql`.
ALTER TABLE "review_requests" ADD COLUMN "pull_request_key" text;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "repo_key" text;--> statement-breakpoint
UPDATE "review_requests" SET "repo_key" = coalesce("data"->'pullRequest'->>'provider', 'github') || ':' || lower("pr_owner") || '/' || lower("pr_repo");--> statement-breakpoint
UPDATE "review_requests" SET "pull_request_key" = "repo_key" || '#' || "pr_number";--> statement-breakpoint
ALTER TABLE "review_requests" ALTER COLUMN "pull_request_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_requests" ALTER COLUMN "repo_key" SET NOT NULL;--> statement-breakpoint
DROP INDEX "review_requests_pr_idx";--> statement-breakpoint
DROP INDEX "review_requests_repo_idx";--> statement-breakpoint
ALTER TABLE "review_requests" DROP COLUMN "pr_owner";--> statement-breakpoint
ALTER TABLE "review_requests" DROP COLUMN "pr_repo";--> statement-breakpoint
ALTER TABLE "review_requests" DROP COLUMN "pr_number";--> statement-breakpoint
CREATE INDEX "review_requests_pr_idx" ON "review_requests" ("org_id","pull_request_key");--> statement-breakpoint
CREATE INDEX "review_requests_repo_idx" ON "review_requests" ("org_id","repo_key","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);

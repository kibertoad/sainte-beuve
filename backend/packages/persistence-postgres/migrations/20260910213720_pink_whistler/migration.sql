CREATE TABLE "ai_review_runs" (
	"id" text PRIMARY KEY,
	"review_id" text NOT NULL,
	"requested_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attention_requests" (
	"id" text PRIMARY KEY,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"provider" text,
	"subject" text,
	"reviewer_id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "identities_pkey" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "integration_tokens" (
	"integration_id" text PRIMARY KEY,
	"sealed" text NOT NULL,
	"hint" text NOT NULL,
	"subject" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"ref_key" text NOT NULL CONSTRAINT "projects_ref_idx" UNIQUE,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" text PRIMARY KEY,
	"review_id" text NOT NULL,
	"status" text NOT NULL,
	"due_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_commitments" (
	"id" text PRIMARY KEY,
	"reviewer_id" text NOT NULL,
	"pull_request_key" text NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" text PRIMARY KEY,
	"status" text NOT NULL,
	"pr_owner" text NOT NULL,
	"pr_repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewers" (
	"id" text PRIMARY KEY,
	"outstanding_reviews" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_review_runs_review_idx" ON "ai_review_runs" ("review_id","requested_at");--> statement-breakpoint
CREATE INDEX "attention_requests_status_idx" ON "attention_requests" ("status","created_at");--> statement-breakpoint
CREATE INDEX "identities_reviewer_idx" ON "identities" ("reviewer_id");--> statement-breakpoint
CREATE INDEX "reminders_review_idx" ON "reminders" ("review_id");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" ("status","due_at");--> statement-breakpoint
CREATE INDEX "review_commitments_reviewer_idx" ON "review_commitments" ("reviewer_id","created_at");--> statement-breakpoint
CREATE INDEX "review_requests_status_idx" ON "review_requests" ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_requests_pr_idx" ON "review_requests" ("pr_owner","pr_repo","pr_number");
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY,
	"token_digest" text NOT NULL CONSTRAINT "api_keys_digest_idx" UNIQUE,
	"label" text NOT NULL,
	"hint" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"token_digest" text NOT NULL CONSTRAINT "sessions_digest_idx" UNIQUE,
	"reviewer_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_created_idx" ON "api_keys" ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_reviewer_idx" ON "sessions" ("reviewer_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" ("expires_at");
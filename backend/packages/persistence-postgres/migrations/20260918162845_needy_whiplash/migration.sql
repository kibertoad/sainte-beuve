ALTER TABLE "reminders" ADD COLUMN "claimed_at" bigint;--> statement-breakpoint
CREATE INDEX "reminders_claimed_idx" ON "reminders" ("org_id","status","claimed_at");
CREATE TABLE "risk_assessments" (
	"org_id" text,
	"review_id" text,
	"status" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "risk_assessments_pkey" PRIMARY KEY("org_id","review_id")
);
--> statement-breakpoint
CREATE INDEX "risk_assessments_status_idx" ON "risk_assessments" ("org_id","status","updated_at");
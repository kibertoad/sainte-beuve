CREATE TABLE "pull_request_assessments" (
	"org_id" text,
	"pull_request_key" text,
	"assessed_at" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "pull_request_assessments_pkey" PRIMARY KEY("org_id","pull_request_key")
);

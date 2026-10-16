CREATE TABLE "host_snapshots" (
	"org_id" text,
	"source" text,
	"key" text,
	"fetched_at" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "host_snapshots_pkey" PRIMARY KEY("org_id","source","key")
);

CREATE TABLE "external_directory" (
	"org_id" text,
	"source" text,
	"kind" text,
	"key" text,
	"seq" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "external_directory_pkey" PRIMARY KEY("org_id","source","kind","key")
);

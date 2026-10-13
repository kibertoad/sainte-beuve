CREATE TABLE "external_repositories" (
	"org_id" text,
	"source" text,
	"key" text,
	"seq" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "external_repositories_pkey" PRIMARY KEY("org_id","source","key")
);

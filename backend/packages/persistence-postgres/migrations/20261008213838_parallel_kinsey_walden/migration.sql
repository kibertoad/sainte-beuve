CREATE TABLE "integration_configs" (
	"org_id" text,
	"integration_id" text,
	"data" jsonb NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "integration_configs_pkey" PRIMARY KEY("org_id","integration_id")
);

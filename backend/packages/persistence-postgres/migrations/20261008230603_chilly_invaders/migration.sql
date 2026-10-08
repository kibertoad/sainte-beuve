CREATE TABLE "teams" (
	"org_id" text,
	"id" text,
	"name_key" text NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "teams_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_idx" ON "teams" ("org_id","name_key");--> statement-breakpoint
-- One team per distinct team name already on a reviewer, with no owner. The id is
-- derived from the name so D1 (`0008_teams.sql`) writes the same one.
INSERT INTO "teams" ("org_id", "id", "name_key", "created_at", "data")
SELECT "org_id", "id", "name_key", "created_at",
  jsonb_build_object('id', "id", 'name', "name", 'ownerId', NULL, 'createdAt', "created_at")
FROM (
  SELECT "org_id",
    lower(trim("data"->>'team')) AS "name_key",
    'team_' || encode(convert_to(lower(trim("data"->>'team')), 'UTF8'), 'hex') AS "id",
    min(trim("data"->>'team') COLLATE "C") AS "name",
    min("created_at") AS "created_at"
  FROM "reviewers"
  WHERE trim(coalesce("data"->>'team', '')) <> ''
  GROUP BY "org_id", lower(trim("data"->>'team'))
) AS "found"
ON CONFLICT DO NOTHING;

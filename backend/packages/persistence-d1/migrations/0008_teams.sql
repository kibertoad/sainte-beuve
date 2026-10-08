-- An org's teams, which a reviewer's `team` is picked from. `name_key` is the
-- trimmed, lowercased name, unique per org.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261008230603_chilly_invaders/migration.sql`.
CREATE TABLE IF NOT EXISTS teams (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_name_idx ON teams (org_id, name_key);

-- One team per distinct team name already on a reviewer, with no owner. The id is
-- derived from the name so Postgres writes the same one.
INSERT INTO teams (org_id, id, name_key, created_at, data)
SELECT org_id, id, name_key, created_at,
  json_object('id', id, 'name', name, 'ownerId', NULL, 'createdAt', created_at)
FROM (
  SELECT org_id,
    lower(trim(json_extract(data, '$.team'))) AS name_key,
    'team_' || lower(hex(lower(trim(json_extract(data, '$.team'))))) AS id,
    MIN(trim(json_extract(data, '$.team'))) AS name,
    MIN(created_at) AS created_at
  FROM reviewers
  WHERE trim(coalesce(json_extract(data, '$.team'), '')) <> ''
  GROUP BY org_id, lower(trim(json_extract(data, '$.team')))
)
WHERE true
ON CONFLICT DO NOTHING;

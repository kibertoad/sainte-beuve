-- The repository lists external systems hold for an org (cat-factory's directory
-- is one), from which its projects are derived while that sync is on. `key` is
-- the source's own key for an entry; one the source dropped keeps its row with a
-- null `repository` in the payload, so its `seq` still refuses an older state.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012002248_true_electro/migration.sql`.
CREATE TABLE IF NOT EXISTS external_repositories (
  org_id TEXT NOT NULL,
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, source, key)
);

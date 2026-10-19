-- One open named ask per requester per pull request among the asks My PRs
-- raises, held by a partial unique index, so two submits landing together
-- write one ask and the second adds its people to it. The key is null on every
-- other ask, and an ask that closes leaves the index, so the next one can open.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261019110347_own_attention_asks/migration.sql`.
ALTER TABLE attention_requests ADD COLUMN own_ask_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_own_idx
  ON attention_requests (org_id, own_ask_key)
  WHERE status = 'open' AND own_ask_key IS NOT NULL;

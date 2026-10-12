-- A revision on every attention request, moved on by each write, so an answer
-- writes only over the row it read and two answers landing together both count.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012114012_lush_mandroid/migration.sql`.
ALTER TABLE attention_requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

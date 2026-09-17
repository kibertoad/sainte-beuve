-- The AI review on the clock: a status column on `ai_review_runs`, so the
-- reminder tick can read what is still in flight.
--
-- Until now the only read of this table was by review id: a run was polled when
-- somebody opened the row it belongs to, and a review that parked with findings
-- while nobody was looking stayed parked. The tick polls them instead, which
-- needs a read the other way round — every unsettled run in this org — and that
-- read must not scan the table.
--
-- The status is in `data` already. It becomes a COLUMN for the same reason
-- `review_requests.status` and `reminders.status` are: a payload JSON extraction
-- cannot be indexed usefully on either engine, and the column is what the
-- planner can reach. Every write sends both, and the payload stays the one a
-- read decodes.
--
-- No table rebuild: SQLite adds a column in place, and the backfill reads the
-- status straight out of the payload each row already carries. The DEFAULT is
-- what SQLite requires of a NOT NULL column added to a table that has rows, and
-- nothing relies on it afterwards: every write sends the status explicitly, and
-- the Postgres column (which is added nullable, backfilled and then tightened)
-- carries no default at all.
ALTER TABLE ai_review_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'requested';
UPDATE ai_review_runs SET status = json_extract(data, '$.status');

-- The tick's only read: what is unsettled in this org, oldest request first.
CREATE INDEX IF NOT EXISTS ai_review_runs_status_idx ON ai_review_runs (org_id, status, requested_at);

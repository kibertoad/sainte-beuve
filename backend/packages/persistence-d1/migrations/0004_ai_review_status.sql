-- The AI review on the clock: a status column and a poll cursor on
-- `ai_review_runs`, so the reminder tick can read what is still in flight and
-- rotate through it fairly.
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
-- `last_polled_at` is the ORDER that read comes back in, and it is a column for
-- the same reason. It is nullable and stays nullable: a run nobody has polled
-- yet has no reading to record, and it is precisely the one the clock should
-- reach first. Ordered by `requested_at` instead, a tenancy holding a batch's
-- worth of reviews parked on their findings — a state only a person leaves,
-- never a poll — would fill every batch for ever and the clock would never reach
-- a newer review at all.
--
-- No table rebuild: SQLite adds a column in place, and the backfill reads the
-- status straight out of the payload each row already carries. The DEFAULT is
-- what SQLite requires of a NOT NULL column added to a table that has rows, and
-- nothing relies on it afterwards: every write sends the status explicitly, and
-- the Postgres column (which is added nullable, backfilled and then tightened)
-- carries no default at all.
ALTER TABLE ai_review_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'requested';
UPDATE ai_review_runs SET status = json_extract(data, '$.status');

-- Backfilled from the payload too, for the rows written before this column
-- existed. Those payloads carry no `lastPolledAt`, so the extraction is null and
-- the run sorts first — which is the right answer: nothing here has been polled
-- since the deployment learnt to record it.
ALTER TABLE ai_review_runs ADD COLUMN last_polled_at INTEGER;
UPDATE ai_review_runs SET last_polled_at = json_extract(data, '$.lastPolledAt');

-- The tick's only read: what is unsettled in this org, least recently polled
-- first.
CREATE INDEX IF NOT EXISTS ai_review_runs_status_idx ON ai_review_runs (org_id, status, last_polled_at);

-- A claim that can be aged, so a send whose process died does not end a ladder.
--
-- `sending` is the tick's claim on a due nudge, and it is transient by intent:
-- the same delivery writes `sent` or `failed` a moment later. A process that
-- dies in between leaves the row in it for good, and that is not one lost
-- nudge — the policy hands out a single reminder at a time and re-plans only
-- once a delivery settles, so the review's whole reminder ladder stops, with
-- nothing on the board saying why.
--
-- `claimed_at` is what makes the stuck row findable: the tick sweeps claims
-- older than a send could possibly be to `failed`, records the reason, and
-- re-plans. NULLABLE, and null is deliberately NOT stalled — the rows that
-- exist before this migration carry no timestamp, and `claimed_at < ?` drops
-- them rather than giving up on a send that may be in flight right now.
--
-- The index mirrors `reminders_due_idx` on the other timestamp: the sweep is
-- `WHERE org_id = ? AND status = 'sending' AND claimed_at < ? ORDER BY
-- claimed_at`, per tenancy, because the tick walks the orgs.
--
-- The Postgres adapter carries the same change as
-- `migrations/20260918162845_needy_whiplash/migration.sql`.
ALTER TABLE reminders ADD COLUMN claimed_at INTEGER;

CREATE INDEX IF NOT EXISTS reminders_claimed_idx ON reminders (org_id, status, claimed_at);

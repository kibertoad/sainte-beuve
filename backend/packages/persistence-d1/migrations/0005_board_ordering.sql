-- The board's ordered reads, given indexes that answer them.
--
-- `GET /reviews` is `WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
-- with an optional status. Before this, neither shape was covered: the only
-- composite started `(org_id, status, created_at)`, so a read that named no
-- status scanned the org's rows and sorted them, and one that did still needed a
-- sort step for the tie-break, because no index ended in `id`.
--
-- Both indexes are declared DESC to match the order the read asks for. SQLite
-- can walk an ascending index backwards, but it then has the far end of the
-- org's history to walk back from, and the point of the cap this route now
-- carries is a scan that takes the newest rows and stops.
--
-- The status index is dropped and recreated rather than added beside: it is the
-- same index with the ordering spelled out and the tie-break added, so leaving
-- the old one would keep a second copy of the same key to maintain on every
-- write.
--
-- The Postgres adapter carries the same change as
-- `migrations/20260918093706_wonderful_captain_flint/migration.sql`.
DROP INDEX IF EXISTS review_requests_status_idx;
CREATE INDEX IF NOT EXISTS review_requests_status_idx ON review_requests (org_id, status, created_at DESC, id DESC);

-- The same read with no status named, which is the unfiltered board.
CREATE INDEX IF NOT EXISTS review_requests_created_idx ON review_requests (org_id, created_at DESC, id DESC);

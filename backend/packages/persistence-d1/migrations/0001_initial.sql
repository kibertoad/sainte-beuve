-- The sainte-beuve board and workspace, on D1.
--
-- Applied by wrangler (`wrangler d1 migrations apply`), which is why this is a
-- file on disk rather than a statement list in TypeScript: a deployment points
-- `migrations_dir` at this directory and gets the schema without importing
-- anything.
--
-- Every table stores its contract object as JSON in `data`; the columns beside
-- it are the indexes the ports read (see `src/rows.ts` for why, and
-- `@sainte-beuve/persistence-postgres` for the same tables in Postgres types).
-- Timestamps are epoch milliseconds, which is what every contract carries.

CREATE TABLE IF NOT EXISTS reviewers (
  id TEXT PRIMARY KEY,
  -- Not derived from `data`: `adjustOutstanding` increments it in one statement,
  -- and every read overlays this column onto the payload.
  outstanding_reviews INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  pr_owner TEXT NOT NULL,
  pr_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_requests_status_idx ON review_requests (status, created_at);
-- A webhook replay looks a review up by the pull request it is about, so this is
-- the index that keeps an intake from scanning the board.
CREATE INDEX IF NOT EXISTS review_requests_pr_idx ON review_requests (pr_owner, pr_repo, pr_number);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reminders_review_idx ON reminders (review_id);
-- The reminder tick's only read: what is scheduled and already due.
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (status, due_at);

CREATE TABLE IF NOT EXISTS ai_review_runs (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_review_runs_review_idx ON ai_review_runs (review_id, requested_at);

-- What is stored is an ENVELOPE, sealed with the deployment's own key. A dump of
-- this table carries no usable credential.
CREATE TABLE IF NOT EXISTS integration_tokens (
  integration_id TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  hint TEXT NOT NULL,
  subject TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  -- `provider:owner/repo`, lowercased. UNIQUE, because the port declares a
  -- repository is registered once and two rows for it would list one project on
  -- the workspace twice.
  ref_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_ref_idx ON projects (ref_key);

-- An identity is `(provider, subject)` and never a handle: a login is
-- renameable and reusable by whoever claims it next. The primary key is what
-- makes the first claim win.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_reviewer_idx ON identities (reviewer_id);

CREATE TABLE IF NOT EXISTS attention_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attention_requests_status_idx ON attention_requests (status, created_at);

CREATE TABLE IF NOT EXISTS review_commitments (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  -- `provider:owner/repo#number`. The host is part of the key: the same path and
  -- number exist on both, and they are two different changes.
  pull_request_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_commitments_reviewer_idx ON review_commitments (reviewer_id, created_at);

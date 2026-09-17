-- The org boundary: a tenancy on every table.
--
-- A session says who is calling; this is what says what they may reach. Every
-- one of the eleven tables gains an `org_id`, and it goes INTO THE PRIMARY KEY
-- rather than beside it: a tenancy a statement can leave out is a tenancy a
-- statement will leave out, and with it in the key a query that forgot the org
-- does not quietly read somebody else's rows.
--
-- SQLite cannot alter a primary key, so each table is rebuilt: create, copy,
-- drop, rename. That is also what makes the backfill exact — every row that
-- existed before this migration belongs to the deployment's default org, and the
-- copy writes it in one statement per table rather than leaving a nullable
-- column somebody has to remember to fill.
--
-- `org_default` is the fixed id `@sainte-beuve/contracts` spells as
-- `DEFAULT_ORG_ID`. A deployment that never makes a second org is entirely
-- inside it and behaves exactly as it did.

-- The tenancies. The one table with no `org_id`, because it is the table that
-- says which orgs there are. The slug is UNIQUE: it is what a sign-in names, and
-- two orgs answering to one name would make which board somebody lands on depend
-- on which row the planner reached first.
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_idx ON orgs (slug);

CREATE TABLE reviewers_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  outstanding_reviews INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO reviewers_orgs (org_id, id, outstanding_reviews, created_at, data)
-- `json_set` rather than the schema default, and this is the one backfill that
-- is a decision rather than a copy. A row written before roles existed belongs
-- to somebody who could already reach every route on this deployment, so it
-- becomes an ADMIN: defaulting it to `member` would upgrade a working
-- deployment into one whose Configuration screen nobody can open.
SELECT 'org_default', id, outstanding_reviews, created_at, json_set(data, '$.role', 'admin')
FROM reviewers;
DROP TABLE reviewers;
ALTER TABLE reviewers_orgs RENAME TO reviewers;

CREATE TABLE review_requests_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  pr_owner TEXT NOT NULL,
  pr_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO review_requests_orgs
SELECT 'org_default', id, status, pr_owner, pr_repo, pr_number, created_at, data FROM review_requests;
DROP TABLE review_requests;
ALTER TABLE review_requests_orgs RENAME TO review_requests;
CREATE INDEX IF NOT EXISTS review_requests_status_idx ON review_requests (org_id, status, created_at);
-- A webhook replay looks a review up by the pull request it is about, inside the
-- org the delivery was placed in.
CREATE INDEX IF NOT EXISTS review_requests_pr_idx ON review_requests (org_id, pr_owner, pr_repo, pr_number);

CREATE TABLE reminders_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO reminders_orgs SELECT 'org_default', id, review_id, status, due_at, data FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_orgs RENAME TO reminders;
CREATE INDEX IF NOT EXISTS reminders_review_idx ON reminders (org_id, review_id);
-- The reminder tick's only read: what is scheduled and already due, in the org
-- it is ticking. The tick walks the orgs, so this index is per tenancy.
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (org_id, status, due_at);

CREATE TABLE ai_review_runs_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO ai_review_runs_orgs SELECT 'org_default', id, review_id, requested_at, data FROM ai_review_runs;
DROP TABLE ai_review_runs;
ALTER TABLE ai_review_runs_orgs RENAME TO ai_review_runs;
CREATE INDEX IF NOT EXISTS ai_review_runs_review_idx ON ai_review_runs (org_id, review_id, requested_at);

-- Each org connects its own GitHub and its own Slack: a credential shared across
-- the boundary would let one tenancy's board write comments as another's bot.
CREATE TABLE integration_tokens_orgs (
  org_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  sealed TEXT NOT NULL,
  hint TEXT NOT NULL,
  subject TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, integration_id)
);
INSERT INTO integration_tokens_orgs
SELECT 'org_default', integration_id, sealed, hint, subject, updated_at FROM integration_tokens;
DROP TABLE integration_tokens;
ALTER TABLE integration_tokens_orgs RENAME TO integration_tokens;

CREATE TABLE projects_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  -- `provider:owner/repo`, lowercased.
  ref_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO projects_orgs SELECT 'org_default', id, ref_key, created_at, data FROM projects;
DROP TABLE projects;
ALTER TABLE projects_orgs RENAME TO projects;
-- UNIQUE PER ORG rather than globally: a repository is registered once inside a
-- tenancy, and two tenancies watching one repository is the ordinary
-- multi-tenant case rather than a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS projects_ref_idx ON projects (org_id, ref_key);
-- The one read an inbound webhook makes before it knows where it is: which org
-- registered this repository. See `TenancyDirectory`.
CREATE INDEX IF NOT EXISTS projects_tenancy_idx ON projects (ref_key, created_at);

-- An identity is `(provider, subject)` and never a handle. It is now
-- `(org_id, provider, subject)`: the same GitHub account is a person in each
-- tenancy that knows them, and one row across all of them would make signing in
-- to a second org hand back the first org's reviewer.
CREATE TABLE identities_orgs (
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, provider, subject)
);
INSERT INTO identities_orgs SELECT 'org_default', provider, subject, reviewer_id, data FROM identities;
DROP TABLE identities;
ALTER TABLE identities_orgs RENAME TO identities;
CREATE INDEX IF NOT EXISTS identities_reviewer_idx ON identities (org_id, reviewer_id);

CREATE TABLE attention_requests_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO attention_requests_orgs SELECT 'org_default', id, status, created_at, data FROM attention_requests;
DROP TABLE attention_requests;
ALTER TABLE attention_requests_orgs RENAME TO attention_requests;
CREATE INDEX IF NOT EXISTS attention_requests_status_idx ON attention_requests (org_id, status, created_at);

CREATE TABLE review_commitments_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  -- `provider:owner/repo#number`. The host is part of the key: the same path and
  -- number exist on both, and they are two different changes.
  pull_request_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO review_commitments_orgs
SELECT 'org_default', id, reviewer_id, pull_request_key, created_at, data FROM review_commitments;
DROP TABLE review_commitments;
ALTER TABLE review_commitments_orgs RENAME TO review_commitments;
CREATE INDEX IF NOT EXISTS review_commitments_reviewer_idx ON review_commitments (org_id, reviewer_id, created_at);

CREATE TABLE sessions_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  -- SHA-256 of the value in the cookie, base64url.
  token_digest TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id)
);
INSERT INTO sessions_orgs
SELECT 'org_default', id, token_digest, reviewer_id, provider, subject, created_at, last_seen_at, expires_at
FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_orgs RENAME TO sessions;
-- UNIQUE ACROSS EVERY ORG, unlike every other index in this migration. The
-- digest is what DECIDES which org a request is in, so it is read before there
-- is an org to scope it by; two rows for one value would make which board a
-- cookie opens depend on which row the planner reached first.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_digest_idx ON sessions (token_digest);
CREATE INDEX IF NOT EXISTS sessions_reviewer_idx ON sessions (org_id, reviewer_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (org_id, expires_at);

CREATE TABLE api_keys_orgs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  label TEXT NOT NULL,
  -- What the key may do in its org. On the ROW rather than derived from whoever
  -- minted it: a key outlives the person who made it.
  role TEXT NOT NULL DEFAULT 'member',
  hint TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  PRIMARY KEY (org_id, id)
);
-- `admin` for the keys that already existed, beside the reviewers above and for
-- the same reason: a key minted before roles existed could already reach every
-- route, and narrowing it here would break whatever is calling with it.
INSERT INTO api_keys_orgs (org_id, id, token_digest, label, role, hint, created_by, created_at, last_used_at)
SELECT 'org_default', id, token_digest, label, 'admin', hint, created_by, created_at, last_used_at
FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_orgs RENAME TO api_keys;
-- Global, beside the sessions' and for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_digest_idx ON api_keys (token_digest);
CREATE INDEX IF NOT EXISTS api_keys_created_idx ON api_keys (org_id, created_at);

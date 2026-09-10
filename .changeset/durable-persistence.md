---
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
---

Make the board durable: D1 behind the Worker, Postgres behind the Node service,
and one suite that holds all three stores to one behaviour.

- **`@sainte-beuve/persistence-d1`** implements the nine repository ports over a
  `D1Database`, and ships the migrations directory a deployment points wrangler
  at (`migrations_dir` in deploy/backend now resolves into the installed
  package, so nothing has to be copied or kept in step).
- **`@sainte-beuve/persistence-postgres`** implements the same ports over
  Drizzle, with typed `jsonb` payloads, the same nine tables in Postgres types,
  and drizzle-kit migrations that are generated, committed, and applied at boot
  before the service accepts a request.
- **The payload IS the row.** Each table stores its contract object as JSON in a
  `data` column, and the scalar columns beside it are indexes derived from it at
  write time (the status a filter reads, the `due_at` the tick scans, the
  `(owner, repo, number)` a webhook replay looks a review up by). The ports are
  coarse, so that set is short and closed; a column per contract field would be
  two mappers per table chasing contracts that still move, and would need a JSON
  column anyway for the findings, the post report and the assignment lists.
  `reviewers.outstanding_reviews` is the one exception, because its port method
  increments: the column is authoritative and the read overlays it, so two
  assignments landing together both count. It is written when a reviewer is
  inserted and moved by nothing but `adjustOutstanding` afterwards, in all three
  stores, so a patch built from a read taken a moment earlier cannot discard an
  assignment that landed in between.
- **The `(provider, subject)` claim is one statement** in both durable stores.
  `link` has to answer whose account it is NOW, and two first sign-ins that both
  found no row are how a directory forks into two people with one account
  between them; the key decides it, the conflict branch leaves the holder alone,
  and `RETURNING` reports who won.
- **`@sainte-beuve/persistence-conformance`** is that behaviour written once:
  cases as data, asserting with `node:assert`, so the D1 run happens inside
  workerd against a migrated database and the Postgres one in Node against
  PGlite, with no container in CI. The in-memory store runs the same cases, so a
  bug found in a durable adapter cannot leave local mode behaving differently.
  List ORDER is part of that behaviour and is asserted as the store answers it,
  ties included: every list sorted on a timestamp is sorted on the id after it,
  because reviewer selection walks its candidates positionally and two rows
  written in the same millisecond would otherwise make one random draw pick a
  different person on a laptop than on a deployment.
- **`projectRefKey` and `pullRequestKey` move to `@sainte-beuve/kernel`.** They
  are domain rules every store needs, and a copy per adapter is how one comes to
  treat `Platform/API` as a second repository, or to answer a GitLab merge
  request with the GitHub pull request of the same number.
- **`/health` reports which store the process is on** (`persistence: "d1"`,
  `"postgres"`, `"memory"`), because "is this deployment durable?" has to be
  answerable from outside it. A facade with nothing configured still boots on
  the in-memory store, which is what keeps local mode and a first deploy working
  with no database, and now says so rather than being discovered after a
  restart. The probe also READS the store and reports `persistenceReady`: a
  database that was created and never migrated resolves as a binding and answers
  nothing, so that deployment gets `status: "degraded"` and a 503 instead of a
  200 beside routes that all fail.
- The Node facade gains `DATABASE_URL`, `DATABASE_MAX_CONNECTIONS` and
  `DATABASE_MIGRATE`; `buildContainer` takes the store and the logger the
  process opened, because opening it is asynchronous and running the migrations
  is part of it. `DATABASE_MIGRATE` takes any spelling of off (`false`, `0`,
  `no`, `off`, any case), a pool ceiling that is not a positive number leaves
  node-postgres its default, and a boot that fails after the store opened closes
  the pool on its way out rather than leaving a process that neither serves nor
  exits.

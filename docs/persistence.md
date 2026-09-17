# Where the board lives

Three implementations of the same eleven repository ports, and one suite that
holds them to one behaviour:

| Store                      | Package                              | Used by                                             |
| -------------------------- | ------------------------------------ | --------------------------------------------------- |
| **D1**                     | `@sainte-beuve/persistence-d1`       | the Cloudflare Worker, when a `DB` binding is there |
| **Postgres**, over Drizzle | `@sainte-beuve/persistence-postgres` | the Node service, when `DATABASE_URL` is set        |
| **In memory**              | `@sainte-beuve/persistence-memory`   | every facade with neither, and the server suite     |

`GET /health` reports which one a process is on (`persistence: "d1"`,
`"postgres"`, `"memory"`). That field exists because "is this deployment
durable?" has to be answerable from outside the process: `memory` is the right
answer on a laptop and an alarm on anything a team can see, and a deployment
that thought it had bound D1 finds out from the probe rather than from an
isolate recycle.

Beside it, `persistenceReady` is the answer to the question the name alone
cannot settle: the probe READS the store (`integration_tokens`, which is the
cheapest question that reaches the schema: four flat columns, no payload to
decode, and one row per integration). A database that was created and
never migrated, or a `DATABASE_URL` pointing at nothing, resolves perfectly well
and answers nothing, so the probe reports `persistenceReady: false`, `status:
"degraded"` and a 503 rather than calling that healthy while every board route
fails.

Nothing above the port knows which store it got. No service branches on it, and
that is what keeps the conformance suite meaningful: a behaviour proved for one
store is a behaviour proved for the code path every deployment runs.

## One schema, in two dialects

Both durable stores carry the same twelve tables with the same columns. Only the
types differ, because only the types have to: `jsonb` where SQLite has `TEXT`,
`bigint` where it has `INTEGER`.

**Every table but `orgs` is keyed on `(org_id, …)`.** The tenancy is IN the
primary key rather than beside it, because a tenancy a query can omit is one a
query will omit: in the key, a statement that forgot the org does not quietly
read another one's rows, it fails to parse. See [orgs.md](./orgs.md) for how the
org gets there — no port method takes one, and no service passes one.

| Table                | Key                           | Columns beside `data`                                                                                                           |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `orgs`               | `id`                          | `slug` (UNIQUE), `created_at`                                                                                                   |
| `reviewers`          | `(org_id, id)`                | `outstanding_reviews`, `created_at`                                                                                             |
| `review_requests`    | `(org_id, id)`                | `status`, `pr_owner`, `pr_repo`, `pr_number`, `created_at`                                                                      |
| `reminders`          | `(org_id, id)`                | `review_id`, `status`, `due_at`                                                                                                 |
| `ai_review_runs`     | `(org_id, id)`                | `review_id`, `status`, `requested_at`                                                                                           |
| `integration_tokens` | `(org_id, integration_id)`    | `sealed`, `hint`, `subject`, `updated_at` (no payload)                                                                          |
| `projects`           | `(org_id, id)`                | `ref_key` (UNIQUE per org), `created_at`                                                                                        |
| `identities`         | `(org_id, provider, subject)` | `reviewer_id`                                                                                                                   |
| `attention_requests` | `(org_id, id)`                | `status`, `created_at`                                                                                                          |
| `review_commitments` | `(org_id, id)`                | `reviewer_id`, `pull_request_key`, `created_at`                                                                                 |
| `sessions`           | `(org_id, id)`                | `token_digest` (UNIQUE globally), `reviewer_id`, `provider`, `subject`, `created_at`, `last_seen_at`, `expires_at` (no payload) |
| `api_keys`           | `(org_id, id)`                | `token_digest` (UNIQUE globally), `label`, `role`, `hint`, `created_by`, `created_at`, `last_used_at` (no payload)              |

The two digests are the exception, and unique across EVERY org: a digest is what
decides which org a request is in, so it is read before there is an org to scope
it by, and two rows for one value would make which board a cookie opens depend on
which row the planner reached first.

`integration_tokens`, `sessions` and `api_keys` are the three tables with no
payload column, and for one reason: every field in them is queried or shown, and
the one that must never be readable is stored as a DIGEST or an ENVELOPE rather
than as the credential. Wrapping those rows in JSON would hide the hint, the
label and the subject an operator reads from anybody looking at the database, and
buy nothing. See [auth.md](./auth.md) for what a session and a key are.

### The payload IS the row

Every table stores its contract object as JSON in one `data` column. The scalar
columns beside it are indexes derived from that payload at write time: the
status a filter reads, the `due_at` the reminder tick scans, the
`(owner, repo, number)` a webhook replay looks a review up by. A read decodes
the payload and ignores them.

This is a trade, and it is the shape the ports asked for. They are coarse by
design (`listDue`, not a query builder), so the set of columns a store has to
index is short and closed. A column per contract field would instead be two
mappers per table to keep in step with contracts that still move every slice,
and it would need a JSON column anyway for the arrays and the nested objects: a
review's assigned reviewers, an AI run's findings and its post report. What the
payload column costs is ad-hoc SQL over a field nobody indexed, which Postgres
answers through `jsonb` and which no code path here needs.

Adding a field to a contract therefore needs no migration. Adding one that has
to be FILTERED or SORTED on needs a column, an index and a migration in both
dialects, which is the price of the port having grown a new question.

**A read parses the payload through its contract schema.** Both durable stores do
it at one place each: `decodeData` in the D1 adapter, and the `payload` column type
in the Postgres schema, which Drizzle calls for every select on a `data` column.
That matters because nothing downstream checks it. `buildHonoRoute` validates
requests and never responses, so the browser's own response gate is the next thing
that would look, and a row from an older contract would surface there as a broken
screen naming a route instead of a row.

Parsing on read is also what makes adding a field cheap in practice rather than
only in theory. A contract field with a default arrives as that default for rows
written before it existed, and a payload with nothing to fall back on raises a
`StoredRowError` naming the table and the row id, which is a statement an operator
can act on. The compiler covers the other direction: the column type carries the
contract type, so a write from a stale shape does not typecheck.

**One field is not in the payload's gift.** `reviewers.outstanding_reviews` is
incremented rather than written (`adjustOutstanding`), so two assignments
landing together must both count: the column is authoritative, the statement is
a single `UPDATE`, and the reviewer mapper overlays the column onto the decoded
payload. It is the only exception in either store.

Which is why the column is written when a reviewer is INSERTED and by nothing
but `adjustOutstanding` afterwards. Every other write leaves it alone, in all
three stores: a patch carries the count that was read a moment earlier, so an
upsert that wrote the column from the payload would discard an assignment that
landed in between and walk the counter backwards every time a rename raced a
review. Selection damps by `1 / (1 + outstanding)`, so a count that is one low
prefers that person for ever.

### Two keys are computed, not stored twice

`projectRefKey` (`provider:owner/repo`, lowercased) and `pullRequestKey`
(`provider:owner/repo#number`) live in `@sainte-beuve/kernel`, because they are
domain rules and every store needs them. A copy per adapter is how one of them
comes to treat `Platform/API` as a second repository, or to answer a GitLab
merge request with the GitHub pull request of the same number.

`projects.ref_key` carries a UNIQUE index, which is the uniqueness the port
declares and the in-memory store can only promise.

## The claim that has to be atomic

`IdentityRepository.link` answers "whose account is this NOW", and the answer is
not always the reviewer that was passed in. Two first sign-ins that both find no
row are how a directory forks into two people with one account between them.

Both durable stores settle it in one statement: insert, and on a conflict with
`(provider, subject)` leave the holder's `reviewer_id` alone and return it. A
caller that already holds the key refreshes the handle on the same trip, which
is what keeps a rename visible. The in-memory store reads and then writes, and
can only promise the same outcome.

## Migrations

Each durable store ships its migrations inside its own package, and a deployment
applies them from there rather than copying them.

**D1** stores plain `.sql` in `@sainte-beuve/persistence-d1/migrations`, applied by
wrangler. `deploy/backend`'s `wrangler.toml` points `migrations_dir` at the
installed copy:

```bash
wrangler d1 create sainte-beuve            # paste the id into wrangler.toml
pnpm --filter @sainte-beuve/deploy-backend db:migrate
```

**Postgres** migrations are generated by drizzle-kit from `src/schema.ts` into
`@sainte-beuve/persistence-postgres/migrations`, committed, and applied by the
Node facade at boot before it serves a request. A rolling deploy otherwise
answers requests against a schema one release behind. A deployment that gates
schema changes on a human sets `DATABASE_MIGRATE=false` and applies
`POSTGRES_MIGRATIONS_DIR` itself.

```bash
pnpm --filter @sainte-beuve/persistence-postgres db:generate   # after editing schema.ts
```

Nothing generates SQL at runtime and nothing pushes a schema straight at a
database: what a deployment applies is what somebody read in a diff.

## The conformance suite

`@sainte-beuve/persistence-conformance` is a list of cases over `Repositories`,
and all three stores run it:

| Store     | Runs in                                  | Against                              |
| --------- | ---------------------------------------- | ------------------------------------ |
| in memory | Node                                     | itself                               |
| D1        | workerd, through the Workers vitest pool | a real D1, migrated as a deploy is   |
| Postgres  | Node                                     | PGlite, migrated from the same files |

The cases are DATA rather than `describe` blocks, and they assert with
`node:assert` rather than a matcher library, because the three suites do not run
in the same place: a shared module that reached for a runner's globals is how the
D1 store would have ended up with a suite of its own.

Two choices in that table are worth stating:

- **D1 is tested inside workerd, not against a SQLite file in Node.** What has
  to hold is that these statements work on the engine the Worker deploys to,
  applied to the schema `wrangler d1 migrations apply` produces. A Node harness
  would prove neither.
- **Postgres is tested against PGlite, not a container.** PGlite is Postgres
  compiled to WASM, so the SQL Drizzle generates meets the real planner and the
  real types, with no service in CI and no port on a laptop. What it does not
  cover is node-postgres itself, which is why `connectPostgres` is thin enough
  to read in one screen.

The cases assert list ORDER as the store answers it, ties and all, rather than
sorting the result first. Every list sorted on a timestamp is sorted on the id
after it, and two rows written in the same millisecond are what the tie-break is
for: reviewer selection walks its candidate list positionally, so a store that
answered in insertion order would turn one random draw into a different person
than a hosted deployment picks. A case that sorted before asserting would pass
against all three stores and prove none of it.

A new port method lands in all three stores in the same change, with a case
here. That is the rule the symmetry rests on: a store that is behind is a
deployment that behaves differently, and the suite is the only thing that
notices.

`storedRowConformanceCases` is a second, smaller list, and it runs against the two
DURABLE stores only. Its cases need a write behind the store's own write path,
since every path a store exposes typechecks against the current contract, and what
they are about is a payload left by an older one. The in-memory store is excluded
on purpose rather than by omission: it holds the objects it was handed for the life
of one process, so no such payload can arise in it, and a case run there would
exercise its own setup hook and nothing else.

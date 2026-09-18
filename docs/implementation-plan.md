# sainte-beuve implementation plan

## What it is

A centralized place to run code review. Four jobs, in order of how much they hurt
today:

1. **Give one person their three lists.** What you have out, what is waiting on
   your review, and what you promised to review, across every registered
   project on every host. Plus the one thing a list cannot do: ask the team to
   look at something, addressed by skill rather than by name.
2. **Find a reviewer with the right skillset.** Not a round-robin and not a
   `CODEOWNERS` file: a weighted random pick from the people who actually hold the
   skills a change needs, damped by what they already owe.
3. **Keep reminders honest.** A nudge for a review nobody picked up, a nudge for a
   reviewer who has gone quiet, a word when a delegated review parks on its
   findings, and one escalation past the deadline. Then it stops.
4. **Trigger an AI review.** sainte-beuve runs no models. It files a `review` task
   against a [cat-factory](https://github.com/kibertoad/cat-factory) instance over
   the published `@cat-factory/sdk` and tracks the run.

Slack and the source-control hosts are how people reach it: GitHub and GitLab
are where reviews happen and where the verdict has to land, Slack is where the
nudge arrives. Nothing is reviewed inside sainte-beuve, on purpose: a diff
rendered here would be a worse copy of the page the review actually happens on,
and every row links out to it.

## Shape of the repo

Mirrors cat-factory's layout, for the same reasons it works there.

| Path                                       | What lives there                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `backend/packages/contracts`               | Valibot wire contracts. The one definition of every model and route, shared by the frontend and every facade. |
| `backend/packages/kernel`                  | Domain errors and PORT interfaces. Nothing here reaches a network or a database.                              |
| `backend/packages/reviewers`               | Who should look: selection, attention audiences, and the cut of a host's list that is yours. Pure.            |
| `backend/packages/reminders`               | Reminder cadence and escalation. Pure.                                                                        |
| `backend/packages/integrations`            | GitHub, GitLab and Slack adapters behind the kernel ports, plus the vendor protocols (signatures, events).    |
| `backend/packages/ai-review`               | The cat-factory gateway. The only package that knows cat-factory exists.                                      |
| `backend/packages/persistence-memory`      | In-memory repositories: what a facade boots with when no database is configured.                              |
| `backend/packages/persistence-d1`          | The D1 store, plus the migrations directory a deployment points wrangler at.                                  |
| `backend/packages/persistence-postgres`    | The Postgres store, over Drizzle, plus its generated migrations.                                              |
| `backend/packages/persistence-conformance` | The suite all three stores run, so they are one behaviour rather than three.                                  |
| `backend/packages/server`                  | The runtime-neutral Hono app: controllers, services, error envelope.                                          |
| `backend/runtimes/cloudflare`              | Worker facade: `fetch` plus a cron-driven reminder clock.                                                     |
| `backend/runtimes/node`                    | Node facade: `@hono/node-server` plus an interval-driven clock.                                               |
| `backend/runtimes/local`                   | Local mode: the Node stack with defaults that need no accounts.                                               |
| `frontend/app`                             | The Nuxt layer (pages, components, composables).                                                              |
| `deploy/*`                                 | Four example deployments, each carrying only configuration.                                                   |

Three rules hold the shape:

- **Decisions are pure, writes are services.** `selectReviewers` and
  `planNextReminder` take data and return data. The services in
  `@sainte-beuve/server` own the ordering and the writes. That is why the interesting
  behaviour is tested without a store.
- **The runtimes stay symmetric.** A capability wired on the Worker and not on Node
  is the failure mode this layout exists to prevent. Anything added to one facade
  lands in the other in the same change.
- **One facade over the source-control hosts.** GitHub and GitLab are two
  adapters behind one `VcsGateway`, resolved per host by `resolveVcs(container,
provider)` from that host's own credential. Above the adapter there is no
  branch on which host a project is on, and no field named after one: a person
  carries a HANDLE PER HOST rather than a `githubLogin`.

## What works today

- **A durable board, on both runtimes**: D1 behind the Worker, Postgres behind
  the Node service, the same twelve tables in each, and one conformance suite that
  proves the three stores (those two and the in-memory one) answer alike. A
  facade with neither bound still boots, and `/health` reports which store it is
  on. See [persistence.md](./persistence.md).
- **The workspace**: `GET /api/v1/workspace` sweeps every registered project
  once per host and cuts the result three ways (yours, waiting on you, promised
  by you), reporting per project whether it could be read at all.
- **The project registry**: GitHub or GitLab repositories, each carrying the
  skill vocabulary an attention request on it picks from.
- **Attention requests**: raised against a pull request with the skills it
  needs, an optional same-team gate and a critical mass; delivered live over
  server-sent events and over a REST inbox that carries the same payload;
  resolved and withdrawn from every inbox the moment enough people commit.
- **The live half reaches the whole deployment**: on the Worker the fan-out is a
  Durable Object per org rather than a bus per isolate, so an ask raised on one
  isolate reaches the pages attached to every other. Optional like every other
  binding — a Worker without it still serves the board on the in-isolate bus —
  and `/health` reports which fan-out is in force. See [realtime.md](./realtime.md).
- **Identity that is not a login**: a person is a reviewer row, and the
  accounts they are known by are `(provider, subject)` rows keyed on each
  host's stable id. A rename keeps somebody's workspace, and one person can
  hold a GitHub and a GitLab account at once.
- **GitLab**, behind the same port as GitHub: listing merge requests, reviewer
  changes (read-merge-write, because GitLab's update replaces the list),
  comments, the account read, and a sign-in.
- The review board API: register a pull request, list it, route it to a reviewer,
  move it through its statuses, delegate it to cat-factory, read the run back.
- **The AI-review loop, end to end**: a `review` task filed on cat-factory, the
  findings it parks with read back through cat-factory's decision surface, each
  one dismissable, and the curated selection posted as inline pull-request
  comments (or handed to a fixer, or closed having posted nothing). The receipt
  for a posting pass comes back with it, so a pass that landed nothing is not
  read as a review nobody has curated; a reviewer that wedged with every slice
  reported can be resumed within the budget cat-factory enforces. A run in flight
  is polled BY THE CLOCK as well as by the read, so a review that parks while
  everybody's board is closed is a fact the deployment holds rather than one
  waiting to be discovered — and one that parks is a rung on the reminder ladder,
  so the fact reaches a person rather than only the row.
- Reviewer selection, with the author and anyone already assigned excluded by the
  service rather than by the caller.
- The reminder policy and the tick that fires it, on both runtimes: the review
  nobody took, the reviewer who has gone quiet, the AI review parked on its
  findings, and one escalation past the deadline.
- Three facades that boot: Worker (smoke-tested inside workerd), Node, local mode.
- A Nuxt SPA: the workspace on `/`, the project registry, the board, the
  reviewer directory and the Configuration screen behind a side navigation.
- **GitHub, three ways**: a GitHub App (installation tokens minted per repository
  on Web Crypto), a "Sign in with GitHub" round trip, and a pasted personal access
  token. Whichever are configured are offered; the strongest present is used. See
  [integrations.md](./integrations.md).
- **GitHub intake**: `pull_request` opens and closes a review, `pull_request_review`
  resolves it, the review label routes it, the AI-review label delegates it, a
  `skill:` label becomes a required skill, and a comment that @-mentions the bot
  gets an answer on the pull request.
- **Slack, both directions**: announcements with buttons, the reminder deliveries,
  and the `/review` slash command (list, take, reroll, snooze, ai) behind Slack's
  own request signing.
- Credentials sealed with AES-256-GCM before they are stored and never readable
  back out of the API, resolved PER REQUEST so one entered in the SPA takes effect
  without a redeploy.
- `GET /health` reporting which optional capabilities the process actually wired,
  outbound and inbound separately.
- **One client, driven by the contracts**: the SPA sends every request through
  `sendByApiContract` against the same contract objects the controllers are
  mounted from, so a path, a method or a response field cannot drift between the
  two halves, and a body that does not match its schema is refused where the call
  was made rather than three components later.
- **Sessions, and keys for the machines**: a sign-in that establishes an
  `HttpOnly` session rather than only storing a credential, so the workspace
  renders for whoever is SIGNED IN rather than for whoever the deployment's token
  acts as; API keys for CI, which are deliberately not people; and one guard over
  both, off by default and turned on with `AUTH_MODE=required`. See
  [auth.md](./auth.md).
- **The reviewer directory is editable**: adding somebody, editing their skills,
  team, per-host handles, Slack id, role and weight, and pausing or resuming them
  in one click.
- **A Slack app belongs to an org**: its signing secret is an org's credential in
  the same sealed store as its bot token, and the slug in the URL it posts to
  (`/webhooks/slack/<org>`) is what places a command on that board — safely,
  because naming an org buys nothing until that org's own secret has verified the
  request. `SLACK_SIGNING_SECRET` survives as the default org's fallback, so a
  deployment that predates this needs no change in Slack.
- **An org boundary, and roles over it**: every row belongs to a tenancy, the
  repositories are bound to one from the caller's own credential before a service
  sees them, and an admin configures the deployment where a member uses it. A
  deployment that never makes a second org is entirely inside the default one and
  behaves exactly as it did. See [orgs.md](./orgs.md).

## What is a placeholder, and why it is still here

| Placeholder                             | Why it exists now                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single cat-factory service id           | cat-factory models one service per repository. A multi-repo deployment needs a mapping.                                                                                            |
| One announcement channel per deployment | `SLACK_CHANNEL_ID` is deployment wiring, so a second org that connects its own Slack app announces into the deployment's channel. The bot token it posts with is already its own.  |
| A stored credential is never re-checked | A pasted GitHub token is verified once, on the way in. One revoked afterwards is still reported as connected until a call fails. A probe would fix it.                             |
| No GitLab intake                        | Merge requests are READ and written, and no GitLab webhook lands here yet, so nothing on GitLab opens a board row by itself. The label vocabulary is GitHub's for the same reason. |

## Slices, in order

### Slice 1: bootstrap (done)

The tree above, three runtimes, the domain packages with their suites, CI, and a
deployment example for each target.

### Slice 2: contract-driven client (done)

Every call the SPA makes goes through `sendByApiContract` against the contract the
controller is mounted from, and the reviewer pool is editable from the screen that
lists it. What that slice decided, in short:

- **The client takes a base URL; the composable supplies it.**
  `createSainteBeuveApi` is a plain function of one string, and
  `useSainteBeuveApi` is the two lines that read it out of runtime config. That is
  what lets the boundary have a suite at all: the cases run in Node with a stubbed
  `fetch` and no Nuxt around them.
- **A refusal keeps its envelope, a transport failure keeps its own message.** The
  API answers `{ error: { code, message } }` and the message names what is missing,
  so that is what a screen shows. A `TypeError` from `fetch` is passed through
  untouched instead, because "the backend is not running" and "the backend refused"
  send whoever is reading the toast to different places.
- **A body that does not match its contract is restated, not dumped.** The
  underlying `SchemaValidationError` carries a JSON blob of every issue and says
  nothing about where it came from; what reaches the screen is the route and the
  first few field paths (`GET /reviewers did not match its contract:
reviewers.0.handles: ...`). The request side is checked first and separately,
  under `invalid_request`, so a value somebody typed is never reported as the route
  breaking its contract, and anything left under `contract_mismatch` is
  response-side by construction.
- **The live half stays an `EventSource`, and the contract still owns its path.**
  `sendByApiContract` can iterate an SSE contract over `fetch`, and that would give
  up the one thing the attention stream needs, which is a reader that reconnects by
  itself after a laptop closes. The URL is built from the stream contract rather
  than typed out, so the rule that no path is hand-written holds anyway, and each
  event is parsed through `attentionEventSchema` so the stream is behind the same
  gate as every fetch.
- **An assign that finds nobody says which of five reasons it was.** The route
  answers 200 with an empty `assigned` list and a `shortfallReason`, because an
  empty pool is a configuration answer rather than a fault. `diagnoseShortfall`
  names the cause it found, coarsest first, so an all-paused pool is never reported
  as a skills problem; `shortfallCause` and `shortfallRemedy` in the contracts
  package are the only copies of the wording, read by both the board and the bot's
  comment on the pull request.
- **A reviewer cannot be deleted, and that is the answer rather than a gap.**
  `paused` is the way out of the pool: it keeps the skills, the team and the host
  accounts, so somebody back from leave reappears as themselves instead of being
  retyped. The row is also what a review's assignment and a linked host account
  point AT, so removing one would leave a board row assigned to nobody and a
  signed-in account attached to nothing.

### Slice 3: GitHub and Slack, for real (done)

Both intakes are wired, both credential paths exist, and the design is
[integrations.md](./integrations.md). What that slice decided, in short:

- **Required skills come from LABELS, not from changed paths.** A per-repo
  path-to-skill map was the original plan, and it is the wrong first move: it is a
  second configuration surface to build and maintain, it needs a fallback rule for
  a change that touches nothing mapped, and it is invisible to whoever opened the
  pull request. `skill:payments` is a gesture a team already knows, it is visible
  on the pull request, and it needs no store. A path map is worth revisiting once
  teams are actually annoyed at typing labels, and then it becomes a source that
  ADDS to them rather than a replacement.
- **A label, not `opened`, is what asks for a reviewer.** Opening a pull request
  tracks it and leaves it unassigned, which is the state the reminder ladder exists
  to shorten. Auto-routing every pull request would put the board in the way of
  people who opened one to look at CI.
- **No installation table.** An App installation is resolved from the repository it
  is used for and cached in memory, so nothing has to be kept in step with what
  somebody later changes on GitHub.

What is left over from it: a `decline` button on the announcement (rerolling covers
it, and "not me" is a different signal worth recording), and per-repository
overrides for the label names.

### Slice 3.5: the working space (done)

The screen a person actually opens, and the three lists behind it. What that
slice decided, in short:

- **A project registry, not a repository crawl.** A deployment lists the
  repositories it watches, and that list is also the only place a team's own
  skill vocabulary lives. Discovering repositories from a token instead would
  sweep everything an account can see, which on a work account is thousands of
  repositories and one rate limit.
- **One list call per project, cut three ways.** Both hosts return the author
  and the requested reviewers on the same page, so a call per role would double
  the cost of one screen and give two halves from two different moments. The
  cut is pure (`partitionForViewer`), so it is tested without a host.
- **The search API is not used**, even though it can filter by author
  server-side: it is eventually consistent, so a pull request opened seconds
  ago is missing from it, and it carries its own much smaller rate limit.
- **An unreadable project is reported, not thrown.** A deployment holding one
  host's credential and not the other's is the normal state; a workspace that
  503s because of the second project is a workspace nobody can use for the
  first.
- **An identity is `(provider, subject)`, never a handle.** A login is
  renameable and reusable by whoever claims it next. The canonical person is
  the reviewer row, which already exists and already carries the skills
  selection matches on, so there is no second `users` table to keep in step.
  On first sight of an account the directory row with that handle is ADOPTED
  rather than forked, because a team registers people long before anybody signs
  in.
- **An attention request resolves itself.** Reaching the critical mass
  withdraws it from every inbox, including the people who never answered. The
  alternative, leaving it up until somebody tidies it away, is how a team
  learns to ignore the next one.
- **Committing is open to anybody, being ASKED is gated.** The skill gate
  decides who the request reaches; somebody who wants to help anyway has made a
  judgement about their own competence that a label list is not in a position
  to overrule. `ReviewService.claim` already made that call for the board.
- **Two delivery paths, one payload.** The stream is not a faster inbox and the
  inbox is not a broken stream: a page opened an hour later has to see the same
  thing, and the REST half is the one that is correct on every runtime.

### Slice 4: the AI review loop (mostly done)

The loop runs: file, read the findings, curate, post. What it decided, in short:

- **The verdict is not a comment we write.** cat-factory posts the review itself,
  on the LINES the findings are about, from the same run that produced them, and
  it knows which of them fall outside the diff and have to be folded into a
  summary instead. Summarising the run into one comment through our own VCS port
  is the obvious alternative and a worse one: a paragraph where there should be
  eight line comments, and a second repository-write credential to hold.
- **Nothing is posted without a person.** cat-factory parks on its findings, and
  the selection is a decision, not a default: a run whose every finding went
  straight onto the pull request would be a bot arguing with an author, and the
  screen would have nothing to be for.
- **The port is addressed by TASK to file and by RUN to curate.** That asymmetry
  is cat-factory's: a task is accepted before its run exists, and the decision
  surface is keyed on the run. A gateway taking a task id for the curation verbs
  would re-resolve the run per call and could act on a different one than the
  findings on screen came from.
- **A posting pass has to leave a receipt.** A `post` that lands nothing re-parks
  the review at `awaiting_selection` with the selection cleared, which is
  byte-for-byte a review nobody has curated. Without `postReport` beside
  `postAttempts` a caller reads back the state it held a moment earlier and
  reports success, which is why the projection carries both and the screen shows
  which comments bounced.
- **A key needs `decide`, not `write`.** A review parks, so cat-factory refuses to
  start one through a key that could not answer it. The refusal arrives when the
  review is filed, and the message names the scope. Filing is translated through
  the same refusal table as the curation verbs for exactly that reason.
- **The receipt outlives the decision.** cat-factory drops a decision from the
  run's list when the loop it belongs to settles, so the poll that sees a review
  FINISH is the poll that sees no decision. A row therefore keeps the curation it
  holds when a report carries none, or the post report and the findings would be
  destroyed at the moment somebody wants to read what landed, and nothing could
  recover them.

What is left:

- Tell somebody a review parked. The clock now DISCOVERS it (slice 7), so the
  board is true without anybody opening a row; what is still missing is the nudge
  that says so, which is a reminder kind rather than a poll.
- A cat-factory-side callback as an OPTIMIZATION over polling, never as a
  replacement: a local deployment has no inbound URL, and a seam that only works in
  production breaks on the day it matters.
- Per-repository cat-factory service mapping, replacing the single
  `CAT_FACTORY_SERVICE_ID`.
- Challenging a finding (cat-factory dispatches an investigator that upholds or
  retracts it). It is a fourth verb on the same surface; the loop is usable
  without it and the screen has nowhere to put the verdict yet.

### Slice 5: durable persistence (done)

D1 behind the Worker, Postgres behind the Node service, one conformance suite
over both and over the in-memory store. The design is
[persistence.md](./persistence.md); what that slice decided, in short:

- **The payload IS the row.** Each table stores its contract object as JSON in
  one `data` column, and the scalar columns beside it are indexes derived from
  it at write time. The ports are coarse on purpose, so the set of columns a
  store has to index is short and closed; a column per contract field would be
  two mappers per table to keep in step with contracts that still move every
  slice, and would need a JSON column anyway for the arrays and the nested
  objects. The one field that is not in the payload's gift is
  `outstanding_reviews`, because its port method INCREMENTS: the column is
  authoritative there, so two assignments landing together both count.
- **Two implementations, one suite.** The stores are not one codebase with two
  drivers: D1 speaks plain SQL over the binding, and the Node side is a Drizzle
  schema with typed `jsonb` payloads and generated migrations. What keeps them
  one BEHAVIOUR is `@sainte-beuve/persistence-conformance`, whose cases are data
  rather than `describe` blocks so the D1 run can happen inside workerd and the
  Postgres one in Node.
- **Each store is tested on the engine it deploys to.** D1 inside workerd
  through the Workers pool, against the schema `wrangler d1 migrations apply`
  produces; Postgres against PGlite, which is Postgres compiled to WASM, so CI
  needs no container and the SQL still meets the real planner.
- **Migrations ship inside the store's own package**, and a deployment applies
  them from there rather than copying them: `migrations_dir` points into the
  installed `@sainte-beuve/persistence-d1`, and the Node facade applies the
  generated Postgres files at boot, before it serves a request, so a rolling
  deploy cannot answer against a schema one release behind.
- **The in-memory store stays**, and is what a facade boots with when nothing is
  configured. It is what makes local mode and a first deploy work with no
  database, and `/health` reports it as `persistence: "memory"` rather than
  letting a deployment discover it after a restart.

The ports were written against that store first on purpose: it has no SQL escape
hatch and no lazy loading, so nothing above the port could grow a dependency on
either, and both adapters implement `Repositories` without an N+1.

What is left over from it:

- **A commitment is not unique per pull request in the store.** The service
  checks before it writes, so a second click is still a no-op; a UNIQUE index
  would make the race impossible rather than unlikely, and the in-memory store
  would have to answer the constraint violation the same way.
- **Nothing here is transactional across two stores.** A service that writes a
  review and then its reminder can be interrupted between them. The ports have
  no unit of work, and adding one costs the in-memory store its simplicity, so
  it waits for a case where the gap is visible.

### Slice 6a: sessions and keys (done)

Sessions for people, API keys for machines, and one guard over both. The design
is [auth.md](./auth.md); what that slice decided, in short:

- **The mode is typed, not derived.** Both derivations fail in the direction that
  hurts: `required` inferred from "an OAuth client exists" locks a laptop out of
  its own board the day somebody configures a sign-in, and `open` inferred from
  "nothing is configured" leaves a hosted deployment open because a variable was
  mistyped. `AUTH_MODE` is a decision somebody typed, and `/health` reports what
  took effect beside the hosts a sign-in could use, so a deployment nobody can
  enter is visible from outside the process.
- **Opaque session, not a JWT.** A self-describing token cannot be revoked, and
  the two things this has to be able to do — sign somebody out, and drop every
  session of a reviewer who was paused or merged away — are both revocations. The
  price is one indexed read per request against a store the request was going to
  touch anyway. The digest is UNKEYED, because at 256 bits there is nothing to
  guess, and keying it would sign everybody out on a key rotation for no gain.
- **A key is not a person, and the refusal says so.** An API key has no reviewer
  row, so the routes that render for a viewer refuse it by name rather than
  inventing somebody: the same answer a GitHub App installation already got, for
  the same reason. Guessing a person for a CI job would put somebody else's work
  on its screen.
- **Two sign-in flows over one OAuth client.** Connecting the DEPLOYMENT's
  credential is an operator's act on shared state; proving who the caller is is
  everybody's. One button doing both would mean every person who signed in
  overwrote the repository-write credential the board runs on. They are told
  apart by the signed state, which is what the flow name was already for.
- **The bootstrap is an environment credential**, `AUTH_API_KEY`, matched before
  the store. A `required` deployment has no sessions and no minted keys, so the
  route that mints the first key would be the route nobody can reach; the same
  shape as `GITHUB_TOKEN` beside a stored GitHub credential, and it keeps working
  while the database is being restored.
- **The session is a cookie, so CORS became load-bearing.** A browser sends a
  credential only to an origin the response NAMES, and the credentials header is
  invalid beside `*`. A hosted deployment therefore has to list its SPA in
  `CORS_ORIGINS` or have an SPA that can read the board and never sign in — which
  is the loud failure rather than the quiet one. Loopback is echoed by name even
  under the wildcard when the deployment is itself loopback, which is what keeps
  local development working.
- **The sweep rides the reminder tick.** It is the one periodic pass both
  runtimes already have, and a sweep wired on the Node interval and not on the
  Worker's cron would be exactly the asymmetry this layout exists to prevent.

### Slice 6b: the org boundary (done)

A tenancy on every table and two roles over it. The design is
[orgs.md](./orgs.md); what that slice decided, in short:

- **The tenancy is bound to the STORE, not passed to it.** No port method takes
  an org and no route accepts one: the authentication middleware reads the org
  off the caller's credential and rebinds the container, and every service below
  asks for a repository exactly as it did before. The alternative —
  `listDue(orgId, now, limit)` on seventy call sites — makes the boundary a rule
  each of them has to obey, and a rule obeyed sixty-nine times is not a boundary.
- **`org_id` is in the primary key, not beside it.** A tenancy a statement can
  omit is one a statement will omit. In the key, a query that forgot the org does
  not quietly read somebody else's rows; it fails to parse.
- **Three reads decide an org and nothing else does.** `TenancyDirectory` is a
  session digest, a key digest, and which org registered a repository — the last
  being what an inbound GitHub delivery has instead of a credential. The list is
  short enough to audit, and nothing on it reads a board, a directory or a
  registry.
- **The default org is a fixed id, so nothing has to be migrated by hand.** Every
  row that predates the boundary is backfilled to `org_default`, and every caller
  a deployment cannot place lands there. Its own ROW is synthesised rather than
  written, because the route every page polls must not be a write.
- **An org is chosen exactly once, in a signed state.**
  `/api/v1/auth/sign-in/<host>?org=<slug>` puts the slug in the round trip's
  signed claims, and the session that comes back is bound to it for good. A slug
  in the callback URL instead would let anybody who can hand somebody a link
  decide which tenancy they land in.
- **The first person into an org is its admin.** An operator who creates an org
  does not become a person in it, so any other rule leaves a tenancy nobody on
  the deployment can configure and no route that could fix it.
- **Anonymous is an admin, and rows that predate roles are admins.** `open`
  refuses nobody, so whoever can reach the deployment can already reach every
  route; answering `member` would take the Configuration screen away from the
  laptop the default exists for while changing nothing about who gets at it. The
  migration follows the same reasoning backwards for the rows already on disk.
- **Pausing somebody signs them out, and demoting them does not.** `paused` is
  the only way out of the directory, so it is the only thing that means "not
  them, for now"; a role is read per request off the reviewer row, so a demotion
  already takes effect at once.

### Slice 7: the AI review on the clock (done)

cat-factory calls nothing back, so until this slice the only thing that ever
asked it where a review got to was somebody opening the row. A review that parked
with its findings therefore waited on a person who had no way of knowing it was
waiting on them. The reminder tick asks on everybody's behalf. What it decided:

- **On the clock AND on the read, not one or the other.** A read polls the runs
  it is about, which is what keeps an OPEN row live; the tick polls what a
  tenancy has in flight, which is what makes a CLOSED one true. Dropping the read
  would make the board lag by up to a tick at the moment somebody is watching it;
  dropping the tick is the state this slice ends.
- **It rides the reminder clock rather than getting one of its own.** That pass
  is the one thing both runtimes already have — a cron trigger on the Worker, an
  interval on Node — and a poll wired on one and not the other is exactly the
  asymmetry the layout exists to prevent. The session sweep is already there for
  the same reason.
- **A status COLUMN on `ai_review_runs`, not a payload extraction.** The clock's
  read is "what is unsettled in this org", which has no review id to narrow it,
  so it is the one read of that table that would scan it. Neither engine indexes
  a JSON extraction usefully, and `review_requests` and `reminders` already carry
  their status the same way.
- **`AI_REVIEW_IN_FLIGHT_STATUSES` is on the contract.** Three stores and the
  poll now agree on what "in flight" means: a `WHERE ... IN` in two SQL dialects,
  a filter in the third, and the service's own guard. Spelled out per store it
  would drift, and silently — a store that forgot `awaiting_selection` would
  simply stop handing parked reviews to the clock.
- **The sweep cannot fail the tick, and is capped like the nudges.** The
  reminders in a pass have already gone out when it runs, so a cat-factory that
  is down for a minute is not a reason to re-send every nudge next minute. A poll
  that is merely refused is recorded on the row, where the board shows it,
  exactly as a read's is.
- **The cap is a rate limit, which takes a second column.** `awaiting_selection`
  is a state no poll can end — only a person curating can — so a batch read
  oldest-request-first would be filled for ever by a tenancy's parked reviews and
  the clock would never reach a newer one: a cap with a permanent head is not a
  cap. `last_polled_at` is the cursor that fixes it. The read is least recently
  polled first, so a run polled on this tick goes to the back and everything in
  flight comes round; a null sorts first, which both durable stores spell out
  because Postgres would otherwise sort it last.
- **What can never be polled is settled rather than skipped.** A run left in
  `requested` with no task id is what a process dying between the row and the call
  leaves behind. Nothing on cat-factory's side can ever settle it, so after a
  grace period the sweep does, and it stops being both a permanent occupant of
  the rotation and a review the board says is still starting.
- **Every org's nudges go out before any org's passengers run.** The tick walks
  the tenancies twice. Interleaved, one org's poll — outbound calls to an instance
  that org configured and nobody else can vouch for — sits in front of every later
  org's reminders, and one slow instance would spend the invocation while the
  tenancies behind it sent nothing.
- **A poll writes onto the row as it stands NOW.** The clock made overlapping
  polls ordinary — a snapshotted batch walked while reads and curation verbs write
  the same rows — so a refusal is not stamped on a run that settled underneath it,
  and a curation from before the last post no longer overwrites the receipt.

### Slice 8: the parked review says so (done)

Slice 7 gave the deployment the fact — the clock asks cat-factory where every
delegated review got to, so a review that parks on its findings is something the
process holds. It held it and told nobody. The row said `awaiting_selection` to
whoever opened it, which is exactly the person who would have opened it anyway,
so the loop still ended at somebody's habit of checking. This slice is the other
half of slice 4: a rung on the reminder ladder for a review waiting on a
CURATOR rather than on a reviewer. What it decided:

- **A reminder kind, not a notification of its own.** Every other thing that
  interrupts somebody about a review is a row in `reminders`: it is scheduled
  ahead of time, it is snoozable from Slack, it records why it could not be
  delivered, and it is capped per tick. A parked review announced through a
  second path would be the one nudge that none of that was true of, and the
  first one nobody could snooze.
- **It is planned by the ladder, so it COMPETES.** `planNextReminder` still
  answers with at most one reminder, decided by the clock rather than by a
  precedence between kinds, and the outstanding schedule for a review is still a
  single row. A parked review that is also past its deadline gets the escalation
  first and the park behind it, because the wide nudge is the one that widens the
  audience and the tick re-plans after every send.
- **Once per park, and a re-park is a new park.** The other rungs chase a
  SILENCE, so repeating them means chasing harder; this one reports an EVENT, and
  a second nudge about the same park says nothing the first did not. What makes
  that a timestamp comparison rather than a budget is the post that fails: it
  re-parks the review with a receipt saying what did not land, and that is a
  thing to say again. `parkedAt` on the run is what the two are told apart by.
- **`parkedAt` is stamped on the EDGE, and it lives on the payload.** On the
  edge because the ladder counts from it: moved on every poll that found the run
  parked, it would push the nudge out by a tick for ever and never send it. On
  the payload — unlike `status` and `lastPolledAt`, which slice 7 promoted to
  columns — because nothing selects on it: the clock reads what is in flight by
  status and the ladder asks for one review's runs by `review_id`, both already
  indexed. A column would be a migration in two dialects bought for a field no
  `WHERE` clause names.
- **The poll re-plans, in both directions.** A poll is the only thing that ever
  learns a review parked, and reminder rows are written ahead of time, so without
  a re-plan the nudge would be scheduled whenever something ELSE happened to
  re-plan the review — which, for a review nobody is touching, is never. The
  other direction matters as much: a park that ends takes the nudge off the
  schedule, so a review curated ten minutes after it parked is not announced
  afterwards. Both run on the read path as well as the clock's, so whichever poll
  gets there first is the one that schedules.
- **It is not gated on the pending budget and does not spend it.** A review
  whose reviewer has gone quiet is exactly the one somebody delegated to
  cat-factory, and going silent about the findings because the human ladder is
  spent would mute the half that still has something new to report.
- **The same audience as the review's own nudge**, which is the assigned
  reviewer's DM or the channel while nobody owns it. The escalation is the only
  rung allowed to widen an audience, and a parked review that went to the channel
  for an assigned review would widen it as a side effect of pressing a button.
- **A resolved review is silent, parked findings and all.** The findings are
  still there and the board still says so, but a pull request that has been
  approved or closed is not something to interrupt anybody about.

### Slice 9: the stream reaches the whole deployment (done)

The attention inbox has always had two paths: a REST fetch that reads the store,
and a live stream over server-sent events. The first was correct everywhere. The
second was correct on the Node service — one process, one bus, every open page on
it — and on the Worker it reached the pages that happened to share the isolate
the publish landed on, which on a busy deployment is most of the time a
respectable number and never all of them. This slice puts a Durable Object behind
`AttentionBus` on the Worker. What it decided:

- **The port did not move, because it was written for this.** `AttentionBus` took
  an org on every method from the day the tenancy landed, for a reason that turns
  out to be the same reason: the bus is the one thing on the container `withOrg`
  cannot hand a scoped copy of, so the org had to be a parameter rather than a
  binding. A second implementation slots in under `scopedBus` and nothing above
  it — no service, no controller, no contract — knows which one it is talking to.
- **One hub per ORG, and the tenancy is the object's identity.**
  `idFromName(orgId)` is the whole of the boundary here: an event published in
  one org reaches a different object from the one another org's streams are
  attached to. There is no filter to get wrong, which matters because the filter
  a subscriber DOES apply — the audience rule — knows about skills and teams and
  nothing about orgs. It is also the sharding: one object per tenancy rather than
  one per deployment, so a large org's fan-out is not in front of a small one's.
- **The hub stores nothing.** Every byte it holds is a socket somebody has a page
  open on, which is what lets the sockets be accepted for HIBERNATION: the
  runtime holds them while the object is evicted, and a publish wakes it with the
  connections still there. An attention event is worth a fan-out and is not worth
  a write — the row it describes is already in the store the REST inbox reads,
  and a hub that replayed history would be a second, worse copy of it that could
  disagree.
- **The bus is built PER REQUEST, which is the opposite of the in-memory one.**
  The in-memory bus has to be held at module level because its state IS the
  subscriber list; a bus built with the Worker's per-request container would have
  one subscriber and no publisher. This one holds no state at all, and it needs
  two things that belong to a request: the runtime's `waitUntil`, and an I/O
  context. workerd refuses a socket used from a request other than the one that
  opened it, so a bus cached across requests would be the one shape the runtime
  rejects outright.
- **`waitUntil` goes down with the bindings.** A publish must not be awaited — it
  follows a write that already succeeded, and letting a fan-out fail that write
  would turn a slow hub into a 500 for the person who raised the ask — and this
  runtime cancels unawaited I/O the moment the response is returned. Those two
  together mean a publish is either deferred by the runtime or occasionally not
  made at all, so `RequestScope` carries the deferral and a runtime with no
  execution context supplies a swallow.
- **The loopback is not optimised away.** A publish does not also fan out locally
  to the isolate it was made on. Doing both would be faster for the fraction of
  readers who share an isolate with the writer, and it would need every frame to
  carry the id of the isolate that sent it so a subscriber could drop its own
  echo — a de-duplication rule paid for on every event, everywhere, to save one
  round trip some of the time.
- **A subscription that dies says so, and the browser is what reconnects.** The
  in-process bus cannot lose a subscriber without being told; one that reaches
  over a socket can, and a response left open afterwards would report itself live
  and deliver nothing for ever. `subscribe` grew an optional `onClose`, the SSE
  response closes on it, and the reconnect belongs to the `EventSource` — which
  retries on its own and refetches the inbox each time it comes back. Rebuilding
  the socket underneath a stream instead would be the one path where events go
  missing with nobody told.
- **Optional, like every other binding, and reported.** A Worker with no
  `ATTENTION` binding still boots, on the in-isolate bus, because the REST inbox
  is what the feature is correct on. `/health` answers `realtime` beside
  `persistence` for the same reason the store is there: every deployment has one
  and what an operator needs to know is WHICH, so a deployment that thought it
  had bound the hub finds out from the probe rather than from the one person
  whose page did not move.
- **Node is not symmetric here, and the asymmetry is in the runtime.** One
  process has no fraction of its pages to miss, so there is nothing to bind. What
  the two facades do share is the answer on `/health`, which is where it will
  show the day the Node service is run behind a load balancer.

### Slice 10: a Slack app belongs to an org (done)

The one surface the org boundary did not reach. A GitHub delivery names a
repository and the registry places it; a slash command named a Slack user and a
channel, and nothing on the deployment mapped either to a tenancy, so every
command acted on the default org. What this slice decided:

- **The org is in the URL, and the org's own secret is what makes that safe.**
  One Slack app serves one tenancy, so its Request URL carries the slug
  (`/webhooks/slack/acme`) and the bare `/webhooks/slack` keeps meaning the
  default org. This is the second place outside a sign-in where a caller names an
  org, and the rule that makes it sound is that naming one BUYS NOTHING: there is
  no credential on an inbound Slack request until the secret the slug selects has
  verified it, so a stranger can write any slug and cannot sign for it. Naming the
  wrong org refuses; it does not admit.
- **`team_id` would have been the obvious routing, and it is the worse one.**
  Placing a command by the workspace id in its body needs a workspace-to-org table
  and a FOURTH read across the boundary, and it would still have to be trusted
  before a signature had been checked against anything. `TenancyDirectory` stays
  at three methods, which is what makes it auditable.
- **The signing secret became a credential rather than wiring.** It is
  `slack-signing-secret` in the same sealed, per-org store as the bot token,
  entered on the Configuration screen and resolved per request like every other,
  so connecting a workspace is not a redeploy. `/health` and the connections read
  resolve it instead of reading the environment, because a flag read off the
  process reports the deployment as it was configured rather than as it is.
- **The deployment's own secret is NOT lent to a named org**, and that
  restriction is the whole security property. `SLACK_SIGNING_SECRET` belongs to
  the deployment's Slack app; if a named org fell back to it, anybody who could
  sign for that app could act on every tenancy by writing a slug in a URL — which
  is exactly the cost placing by URL would otherwise have. A named org with
  nothing stored is refused, naming the credential to store. It survives as the
  DEFAULT org's fallback, which is what keeps every deployment that predates this
  working with no change in Slack: such a deployment is entirely inside the
  default org, so the deployment's secret is its org's secret.
- **One slug rule, not two.** `OrgService.bySlug` decides what a slug in an
  unauthenticated path means — including that `default` answers whether or not
  its row exists — and both the sign-in and the intake ask it. Two copies of that
  rule is how they come to disagree about which board somebody landed on.

### Slice 11: what is next

The placeholders above are the list. The loudest is now that a stored credential
is never re-checked, so one revoked after it was entered reads as connected until
a call fails; a probe would fix it. Beside it, the announcement channel is still
one per deployment, so a second org that connected its own Slack app posts its
announcements into the deployment's channel; and cat-factory is still one service
id for every repository.

## Decisions worth recording

**Weighted random, not round-robin.** A deterministic rotation is predictable in the
bad sense: people learn their slot, pre-empt it and trade it away, and it stops
reflecting who is free. Weighted random keeps the long-run share honest while no
single assignment is anybody's turn to resent.

**Skills are an ALL-of gate, not a ranking.** A review that needs `payments` must not
fall to somebody who merely knows `typescript`. A partial match reads to the author
like a real review and is not one.

**cat-factory over its published SDK.** The SDK's operations are generated from
cat-factory's own OpenAPI spec, so a deployment bumping cat-factory cannot silently
drift from what we send. Reimplementing the wire format would give up exactly that.

**Every integration is optional.** A deployment with no Slack token still serves the
board, and the route that needs one answers 503 naming what is missing. This is what
makes the first deploy possible before any app registration exists, and it is what
makes local mode the same app rather than a reduced one.

**A credential's precedence is documented on the contract, not in the resolver.**
Which of three GitHub credentials wins is the one thing an operator has to be able
to predict, so the order lives on `githubAuthMethodSchema` with the reason for each
step, and the resolver implements it. The Configuration screen then says which one
is in force and which are being shadowed, because "stored" and "in use" are
different facts and a screen that conflates them reports a capability the
deployment does not have.

**An unsigned inbound request is refused, not trusted.** A deployment with no
webhook secret answers 503 to every GitHub delivery and every Slack command,
naming the variable. The alternative, acting on an unverified body, would let
anybody who can find the URL close a review or reassign one.

**In-memory persistence was the first adapter, not a test double.** Writing the
ports against a store that cannot cheat (no SQL escape hatch, no lazy loading)
is what kept them coarse enough for D1 and Postgres to implement without an
N+1, and it is still what a facade with no database configured boots with.

**A handle per host, never a `githubLogin`.** The same engineer is one name on
GitHub and another on GitLab, and every place that mirrors an assignment or
matches an author has to ask for the handle belonging to the pull request's own
host. One field would address the wrong person the day a second host is
registered, and it would do it silently.

**The workspace and the board are two screens on purpose.** The workspace is
what one person has to act on, read live from the hosts. The board is what the
deployment has taken responsibility for: the rows a label or a webhook created,
which the reminder ladder is chasing. Merging them would put a team-wide
backlog in the way of somebody's own three lists, and it would make a
person-driven promise and a webhook-driven assignment look like one thing.

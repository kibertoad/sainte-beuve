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
   reviewer who has gone quiet, and one escalation past the deadline. Then it stops.
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
  the Node service, the same eleven tables in each, and one conformance suite that
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
  reported can be resumed within the budget cat-factory enforces.
- Reviewer selection, with the author and anyone already assigned excluded by the
  service rather than by the caller.
- The reminder policy and the tick that fires it, on both runtimes.
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
  team, per-host handles, Slack id and weight, and pausing or resuming them in one
  click.

## What is a placeholder, and why it is still here

| Placeholder                             | Why it exists now                                                                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single cat-factory service id           | cat-factory models one service per repository. A multi-repo deployment needs a mapping.                                                                                                                                             |
| A stored credential is never re-checked | A pasted GitHub token is verified once, on the way in. One revoked afterwards is still reported as connected until a call fails. A probe would fix it.                                                                              |
| An AI review is polled on the READ      | Nothing drives `refresh()` on a clock, so a review that parks while nobody is looking sits there until somebody opens the row. The reminder tick is where that belongs.                                                             |
| No org boundary behind the session      | A session says WHO is calling and nothing says what they may reach: every authenticated caller sees the same board, the same directory and the same registry. It is the second half of slice 6 and it touches every table.          |
| The attention stream is per process     | An in-memory bus reaches every page on the Node service and only one isolate's on the Worker. The REST inbox carries the same payload and is what makes the feature correct; a Durable Object behind `AttentionBus` closes the gap. |
| No GitLab intake                        | Merge requests are READ and written, and no GitLab webhook lands here yet, so nothing on GitLab opens a board row by itself. The label vocabulary is GitHub's for the same reason.                                                  |

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

- Drive `refresh()` from the same tick that drives reminders, so a review that
  parks while nobody is looking reaches the board (and a reminder) by itself
  rather than on the next read.
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
  under the wildcard, which is what keeps local development working.
- **The sweep rides the reminder tick.** It is the one periodic pass both
  runtimes already have, and a sweep wired on the Node interval and not on the
  Worker's cron would be exactly the asymmetry this layout exists to prevent.

### Slice 6b: the org boundary

A session says who is calling; nothing yet says what they may reach. Every
authenticated caller sees the same board, the same reviewer directory and the
same project registry, and every API key is as powerful as every other.

Closing it is not a new idea on top of 6a, it is a column: a tenancy on every
table, a scope on every port, a migration per dialect, and a case per store in
`@sainte-beuve/persistence-conformance`. It is deliberately separate because it
touches all eleven tables and the half above it — knowing who is calling — is
worth having before it lands rather than after.

Two smaller things fall out of 6a and belong here:

- **Pausing somebody does not sign them out.** `deleteForReviewer` exists on the
  session port and nothing calls it, because what pausing should mean for ACCESS
  (as opposed to for selection) is a policy question this slice did not answer.
- **Roles are the same gap one level down.** "Can revoke an API key" and "can
  read the board" are the same permission today.

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

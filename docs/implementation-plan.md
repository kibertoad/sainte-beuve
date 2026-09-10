# sainte-beuve implementation plan

## What it is

A centralized place to run code review. Three jobs, in order of how much they hurt
today:

1. **Find a reviewer with the right skillset.** Not a round-robin and not a
   `CODEOWNERS` file: a weighted random pick from the people who actually hold the
   skills a change needs, damped by what they already owe.
2. **Keep reminders honest.** A nudge for a review nobody picked up, a nudge for a
   reviewer who has gone quiet, and one escalation past the deadline. Then it stops.
3. **Trigger an AI review.** sainte-beuve runs no models. It files a `review` task
   against a [cat-factory](https://github.com/kibertoad/cat-factory) instance over
   the published `@cat-factory/sdk` and tracks the run.

Slack and GitHub are how people reach it: GitHub is where a review starts and where
the verdict has to land, Slack is where the nudge arrives.

## Shape of the repo

Mirrors cat-factory's layout, for the same reasons it works there.

| Path                                  | What lives there                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `backend/packages/contracts`          | Valibot wire contracts. The one definition of every model and route, shared by the frontend and every facade. |
| `backend/packages/kernel`             | Domain errors and PORT interfaces. Nothing here reaches a network or a database.                              |
| `backend/packages/reviewers`          | Reviewer selection: skill matching, load-aware weighted random. Pure.                                         |
| `backend/packages/reminders`          | Reminder cadence and escalation. Pure.                                                                        |
| `backend/packages/integrations`       | GitHub and Slack adapters behind the kernel ports, plus the vendor protocols (signatures, events, commands).  |
| `backend/packages/ai-review`          | The cat-factory gateway. The only package that knows cat-factory exists.                                      |
| `backend/packages/persistence-memory` | In-memory repositories: what every runtime boots with today.                                                  |
| `backend/packages/server`             | The runtime-neutral Hono app: controllers, services, error envelope.                                          |
| `backend/runtimes/cloudflare`         | Worker facade: `fetch` plus a cron-driven reminder clock.                                                     |
| `backend/runtimes/node`               | Node facade: `@hono/node-server` plus an interval-driven clock.                                               |
| `backend/runtimes/local`              | Local mode: the Node stack with defaults that need no accounts.                                               |
| `frontend/app`                        | The Nuxt layer (pages, components, composables).                                                              |
| `deploy/*`                            | Four example deployments, each carrying only configuration.                                                   |

Two rules hold the shape:

- **Decisions are pure, writes are services.** `selectReviewers` and
  `planNextReminder` take data and return data. The services in
  `@sainte-beuve/server` own the ordering and the writes. That is why the interesting
  behaviour is tested without a store.
- **The runtimes stay symmetric.** A capability wired on the Worker and not on Node
  is the failure mode this layout exists to prevent. Anything added to one facade
  lands in the other in the same change.

## What works today

- The review board API: register a pull request, list it, route it to a reviewer,
  move it through its statuses, delegate it to cat-factory, read the run back.
- Reviewer selection, with the author and anyone already assigned excluded by the
  service rather than by the caller.
- The reminder policy and the tick that fires it, on both runtimes.
- Three facades that boot: Worker (smoke-tested inside workerd), Node, local mode.
- A Nuxt SPA with the board, the reviewer directory and the Configuration screen
  behind a side navigation.
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

## What is a placeholder, and why it is still here

| Placeholder                                | Why it exists now                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-memory persistence                      | Deliberately not durable, so the missing adapter cannot be forgotten. An isolate recycle loses the board, loudly.                                      |
| `useSainteBeuveApi` calling routes by path | The contracts already carry method, path and response schema; swapping in `sendByApiContract` is a change in one file.                                 |
| Single cat-factory service id              | cat-factory models one service per repository. A multi-repo deployment needs a mapping.                                                                |
| A stored credential is never re-checked    | A pasted GitHub token is verified once, on the way in. One revoked afterwards is still reported as connected until a call fails. A probe would fix it. |
| No AI-review verdict on the pull request   | A run is filed and polled, and nothing posts the result back. That is the rest of slice 4.                                                             |

## Slices, in order

### Slice 1: bootstrap (done)

The tree above, three runtimes, the domain packages with their suites, CI, and a
deployment example for each target.

### Slice 2: contract-driven client

Replace the hand-written paths in `useSainteBeuveApi` with `sendByApiContract` from
`@toad-contracts/frontend-http-client`, against the same contract objects the
controllers mount. A response that does not match its contract then fails at the
client boundary instead of three components later.

Also: reviewer CRUD in the SPA, so the pool is manageable without curl.

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

### Slice 4: the AI review loop

Today a run is filed and polled. The credential half landed with slice 3: every
gateway is built per request from whatever credential the deployment holds, through
one `GatewayFactory` each facade supplies, so a key entered in the SPA takes effect
on the Worker and on the Node service alike. What is still missing is what happens
when a run finishes:

- Post the verdict back as a pull-request comment through the VCS port.
- Drive `refresh()` from the same tick that drives reminders, so a completed run
  updates without anyone opening the board.
- A cat-factory-side callback as an OPTIMIZATION over polling, never as a
  replacement: a local deployment has no inbound URL, and a seam that only works in
  production breaks on the day it matters.
- Per-repository cat-factory service mapping, replacing the single
  `CAT_FACTORY_SERVICE_ID`.

### Slice 5: durable persistence

Two adapters against the ports that already exist, landing together to keep the
runtimes symmetric:

- **D1** for the Worker, with a migrations directory shipped inside
  `@sainte-beuve/worker` (the pattern cat-factory uses, so a deployment points
  `migrations_dir` at the installed package).
- **Postgres and Drizzle** for the Node service, with the same schema.

The ports were written against the in-memory store first on purpose: it has no SQL
escape hatch and no lazy loading, so nothing above the port could grow a dependency
on either.

A conformance suite runs the same assertions against all three implementations. That
is the guard that keeps them one behaviour instead of three.

### Slice 6: auth and tenancy

Everything above is single-tenant and unauthenticated, which is fine for local mode
and wrong for a hosted deployment. Sessions, an org boundary around the reviewer pool
and the board, and API keys for the machine callers.

The configuration routes are the ones this is most overdue for, because they hold a
credential rather than a board row. Until it lands they are guarded by two things
that are not authentication: a credential can be written and never read back, and
`/api/v1/settings` is excluded from the wildcard CORS default, so a page the operator
happens to visit cannot preflight a write into the token store. A caller that reaches
the deployment directly still can, and that is what a session closes.

The connect flows raise the stakes and do not change the shape of the answer. A
sign-in is signed end to end (the state is HMAC'd under a key derived from the
deployment's own, checked before the code is spent, and scoped to its flow so one
callback cannot accept another's), so nobody can bind their GitHub account to this
deployment by handing an operator a link. What they still cannot do is prove WHO
started the flow, because there is no identity to bind it to yet. That is the same
gap, on a route that now stores a repository-write credential.

Deliberately last: it is the slice whose shape depends most on how the first five are
actually used, and the least useful one to guess at now.

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

**In-memory persistence is the first adapter, not a test double.** Writing the ports
against a store that cannot cheat is what keeps them coarse enough for D1 and
Postgres to implement without an N+1.

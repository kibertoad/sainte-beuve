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
| `backend/packages/integrations`       | GitHub and Slack adapters behind the kernel ports.                                                            |
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
- A Nuxt SPA with the board and the reviewer directory.
- `GET /health` reporting which optional capabilities the process actually wired.

## What is a placeholder, and why it is still here

| Placeholder                                     | Why it exists now                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /webhooks/github`, `POST /webhooks/slack` | Answer 501, but the paths get registered in a GitHub App and a Slack app by hand. Adding them later means re-registering both. |
| In-memory persistence                           | Deliberately not durable, so the missing adapter cannot be forgotten. An isolate recycle loses the board, loudly.              |
| `useSainteBeuveApi` calling routes by path      | The contracts already carry method, path and response schema; swapping in `sendByApiContract` is a change in one file.         |
| Single cat-factory service id                   | cat-factory models one service per repository. A multi-repo deployment needs a mapping.                                        |

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

### Slice 3: GitHub and Slack, for real

**GitHub.** Move from a PAT to a GitHub App: an installation token per org, so a
hosted deployment needs no human's credential. Wire the webhook intake that already
has its route:

- `pull_request` `opened`/`ready_for_review` opens a review request; `closed` closes
  it. The mapping function and the signature check already exist and are tested.
- `pull_request_review` `submitted` resolves it to `approved` or
  `changes_requested`, which is what stops the reminder clock.
- Required skills come from the changed paths, matched against a per-repo
  path-to-skill map. This is the piece with real design left in it: the map has to be
  editable by the team, and a change that touches nothing mapped must fall back to
  "anyone available" rather than to nobody.

**Slack.** Two inbound surfaces on the route that already exists, both signed
(`verifySlackSignature`, written and tested):

- `/review` slash command: register a PR, reroll the reviewer, snooze a reminder.
- Action buttons on the announcement message: take it, decline it, snooze a day.

Slack is reached with plain `fetch`, not `@slack/web-api`: the official client pulls
in `node:os`, which workerd does not provide, so importing it makes the Worker bundle
fail to load. Bolt is not the alternative either, because it owns a server and a
socket and the Worker has neither.

### Slice 4: the AI review loop

Today a run is filed and polled. What is missing is what happens when it finishes:

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

**In-memory persistence is the first adapter, not a test double.** Writing the ports
against a store that cannot cheat is what keeps them coarse enough for D1 and
Postgres to implement without an N+1.

# sainte-beuve

Centralized review solution to make reviews fun and easy.

Open it and you get your **workspace**: the pull requests you have out, the ones
waiting on your review, and the ones you said you would review. Register the
GitHub or GitLab projects you work in and all three fill themselves.

You do not review a pull request here. Every row links out to the review page on
its host, because that is where the diff, the threads and the approve button
live. What sainte-beuve does is decide who should look, and get them there.

Four jobs: hand somebody the three lists they actually have to act on, find a
reviewer who holds the skills a change needs, keep the reminders honest, and
hand the pull request to an AI reviewer when that is the faster answer. GitHub
and GitLab are where reviews live; Slack is where the nudge arrives; the AI
review runs on a [cat-factory](https://github.com/kibertoad/cat-factory)
instance, local or centralized.

Label a pull request `needs-review` and it lands on the board with a reviewer on it.
Mention the bot in a comment and it answers there. Take the review from a Slack
button, or snooze it with `/review snooze`. How all of that is wired, and what has
to be registered where, is [docs/integrations.md](./docs/integrations.md).

## The AI review is a loop, not a button

Press **AI review** on a board row and the pull request goes to cat-factory,
which fans the diff out across parallel reviewers. It posts nothing. It comes
back and waits, and the row opens on what it found: each finding with its
severity, the file and line it is about, and the fix it suggests.

You are the gate. Tick the ones worth saying out loud (the blockers and the highs
start ticked), **Dismiss** the noise, and then choose:

- **Post inline** puts the selection on the pull request as review comments, on
  the lines they belong to. A finding whose line is outside the diff is folded
  into the summary comment rather than dropped.
- **Send to a fixer** hands the selection to an agent that commits onto the
  reviewed branch.
- **Finish without posting** closes the review having said nothing, which is the
  right answer more often than it sounds.

Posting reports back. If seven comments went out and two bounced, the row says
which two and why, against the attempt number, and posting again skips what
already landed rather than commenting twice. And if the reviewer wedges with
every slice of the diff already in, **Resume** re-dispatches only the slices that
never reported, so a review that stalled on its last turn is not thrown away.

Nothing here polls in the background: the board reads cat-factory when you open
the row, and stops when you close it.

## Asking for attention

A pull request that nobody has picked up is the thing the workspace exists to
fix. Press **Ask for attention** on one of yours and say what a reviewer needs:
which skills (from the project's own vocabulary, `Backend` and `Frontend` until
a team names its own), how many people you want, and whether the ask should stay
inside your team.

Everyone available who holds all of those skills is asked, two ways at once. A
page already open is pushed the request over server-sent events; a page opened
an hour later fetches the same thing over REST. Neither is a fallback for the
other, and both carry the same payload.

The ask ANSWERS ITSELF. Once enough people have said they will review, it is
resolved and disappears from everybody's inbox, including the people who never
got round to it. An ask that stayed up after it was answered would train the
team to ignore the next one.

## Who is in the pool

Both of those depend on the same list, and **Reviewers** is where it is kept: who
can be asked, what they know, and how much they should take.

A person carries a handle PER HOST, and the screen shows both, because a reviewer
with no handle on the host a project lives on is invisible in that project's
workspace and this is the only place that says so. Skills are an ALL-of gate: a
review that needs `payments` is never handed to somebody who merely knows
`typescript`, so a partial match is not a near miss, it is not a candidate.
Weight is the share of the load, for somebody part-time or ramping up.

Going heads-down is one click: **Pause** takes somebody out of every selection and
keeps their row, so they come back as themselves rather than being retyped. There
is no delete, for the same reason and one more: the row is what a review's
assignment and a signed-in host account point at.

## Try it in one command

```bash
pnpm install
pnpm dev:local      # API on http://localhost:8788
pnpm dev:frontend   # SPA on http://localhost:3000
```

Nothing has to be registered anywhere first. No database, no Slack app, no GitHub
app, no cat-factory account: every integration is optional, and `GET /health` reports
which ones this process wired. Attach them one at a time when you want them, see
[deploy/local](./deploy/local/README.md).

Local mode is the same app the hosted deployments serve, with different defaults, not
a reduced build.

## Repository layout

| Path                                       | Package                                 | What it is                                                      |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------------------------- |
| `backend/packages/contracts`               | `@sainte-beuve/contracts`               | Valibot wire contracts, shared by the frontend and every facade |
| `backend/packages/kernel`                  | `@sainte-beuve/kernel`                  | Domain errors and port interfaces                               |
| `backend/packages/reviewers`               | `@sainte-beuve/reviewers`               | Reviewer selection, attention audiences, workspace cuts (pure)  |
| `backend/packages/reminders`               | `@sainte-beuve/reminders`               | Reminder cadence and escalation (pure)                          |
| `backend/packages/integrations`            | `@sainte-beuve/integrations`            | GitHub, GitLab and Slack adapters, and the protocols they speak |
| `backend/packages/ai-review`               | `@sainte-beuve/ai-review`               | The cat-factory gateway                                         |
| `backend/packages/persistence-memory`      | `@sainte-beuve/persistence-memory`      | In-memory repositories, for a facade with no database           |
| `backend/packages/persistence-d1`          | `@sainte-beuve/persistence-d1`          | The D1 store and its migrations                                 |
| `backend/packages/persistence-postgres`    | `@sainte-beuve/persistence-postgres`    | The Postgres store, over Drizzle, and its migrations            |
| `backend/packages/persistence-conformance` | `@sainte-beuve/persistence-conformance` | The suite all three stores run                                  |
| `backend/packages/server`                  | `@sainte-beuve/server`                  | The runtime-neutral Hono app                                    |
| `backend/runtimes/cloudflare`              | `@sainte-beuve/worker`                  | Cloudflare Worker facade                                        |
| `backend/runtimes/node`                    | `@sainte-beuve/node-server`             | Node.js service facade                                          |
| `backend/runtimes/local`                   | `@sainte-beuve/local-server`            | Local-mode facade                                               |
| `frontend/app`                             | `@sainte-beuve/app`                     | The Nuxt layer                                                  |
| `deploy/backend`                           | `@sainte-beuve/deploy-backend`          | Example Cloudflare Worker deployment                            |
| `deploy/node`                              | `@sainte-beuve/deploy-node`             | Example Node.js service deployment                              |
| `deploy/local`                             | `@sainte-beuve/deploy-local`            | Local mode                                                      |
| `deploy/frontend`                          | `@sainte-beuve/deploy-frontend`         | Example Cloudflare Pages deployment                             |

Read [docs/implementation-plan.md](./docs/implementation-plan.md) for what is built,
what is a placeholder, and what lands next,
[docs/integrations.md](./docs/integrations.md) for the GitHub and Slack design,
[docs/persistence.md](./docs/persistence.md) for where the board lives,
[docs/auth.md](./docs/auth.md) for who is allowed to call it, and
[docs/orgs.md](./docs/orgs.md) for what they may reach once they are in.

## Connecting GitHub, GitLab and Slack

Every source-control host goes through one facade: an adapter behind
`VcsGateway`, resolved per host from whichever credential that host has. Nothing
above the adapter knows a merge request from a pull request, and adding a third
host adds no code outside its own directory.

Three ways to connect GitHub, and they are not alternatives to pick between at
deploy time: whichever are configured are offered on the Configuration screen, and
the strongest one present is what calls are made with.

- a **GitHub App**, which mints an installation token per repository and is the
  only credential that is not a person's;
- **Sign in with GitHub**, which stores the token a live authorisation produced;
- a **personal access token**, pasted on the Configuration screen or set as
  `GITHUB_TOKEN`.

GitLab has the same order minus the App, which it has no equivalent of: a
sign-in, then a pasted token, then `GITLAB_TOKEN`. One `GITLAB_BASE_URL`
configures a self-managed install, because GitLab serves its API and its OAuth
endpoints under the same root.

Slack needs a bot token to post, and separately a signing secret to trust the
`/review` command and the message buttons coming back. Every URL that has to be
registered is shown on the Configuration screen with this deployment's own base
URL filled in. Full setup: [docs/integrations.md](./docs/integrations.md).

## Who is allowed to call it

A deployment runs `open` by default, which is what a laptop wants: nothing is
refused for being anonymous, and the workspace renders for whoever the
deployment's own source-control credential acts as. Set `AUTH_MODE=required` and
every route but the sign-in ones needs a caller.

A **person** signs in through GitHub or GitLab and is carried by an `HttpOnly`
session cookie; the workspace then renders for THEM rather than for the
deployment's credential. A **machine** presents an API key minted on the
Configuration screen (`Authorization: Bearer sbk_…`), and a key is deliberately
not a person: it can drive the board and it has no workspace of its own.

`GET /health` reports the mode beside the hosts a sign-in could actually use, so
a deployment nobody can enter is visible from outside the process. One thing to
know before turning it on: a browser sends its session only to an origin the API
NAMES, so a hosted SPA has to be listed in `CORS_ORIGINS`. Full design:
[docs/auth.md](./docs/auth.md).

### And what they may reach

Every row belongs to an **org**, and the repositories a request reaches are bound
to the one its credential names before any handler runs — so a board, a directory
and a registry belong to a tenancy rather than to the deployment. A deployment
that never makes a second org is entirely inside the default one and behaves
exactly as it did; `POST /api/v1/settings/orgs` makes another, and people sign in
to it with `/api/v1/auth/sign-in/<host>?org=<slug>`.

Two roles over that: an **admin** configures the org — credentials, API keys, the
project registry, the reviewer directory — and a **member** uses it. The first
person to sign in to an org is its admin. Full design, including what the
boundary does not reach yet: [docs/orgs.md](./docs/orgs.md).

## Hosting it

Both backends serve the same Hono app and the same routes; pick whichever matches
your infrastructure.

- **Cloudflare Worker** ([deploy/backend](./deploy/backend/README.md)): the reminder
  clock runs on a cron trigger.
- **Node.js service** ([deploy/node](./deploy/node/README.md)): the same clock on an
  interval, in a container.
- **SPA** ([deploy/frontend](./deploy/frontend/README.md)): a static Nuxt build on
  Cloudflare Pages, or any static host.

The board is durable on both: D1 on the Worker, Postgres on the Node service, one
schema and one suite behind them ([docs/persistence.md](./docs/persistence.md)). A
deployment that binds neither still boots, on a store a restart empties, and
`GET /health` reports which one it is on and whether it answers.

## Working in the repo

```bash
pnpm build          # tsc -b across the project-reference graph, via turbo
pnpm typecheck
pnpm test           # every suite
pnpm test:changed   # only what the diff touches
pnpm lint           # oxlint + oxfmt --check
pnpm lint:fix
```

Toolchain: pnpm 11.25, Turborepo, TypeScript 7 on the backend (TypeScript 6 on the
frontend, until Nuxt's toolchain follows), oxlint + oxfmt, Vitest, Nuxt 4 with
Nuxt UI 4.

oxlint enforces size budgets from the first commit: 400 lines per file, 60 lines per
function, 4 parameters, complexity 12. They are deliberately low, and raising one
needs the reason in the diff.

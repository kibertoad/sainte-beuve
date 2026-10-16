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

Label a pull request or a merge request `needs-review` and it lands on the board
with a reviewer on it. Mention the bot in a comment and it answers there. Take the review from a Slack
button, or snooze it with `/review snooze`. How all of that is wired, and what has
to be registered where, is [docs/integrations.md](./docs/integrations.md).

## The AI review is a loop, not a button

Press **AI review** on a pull request and it goes to cat-factory, which fans
the diff out across parallel reviewers. The button is on every board row, and on
the workspace, My PRs and My Reviews for any repository that is linked. A pull
request that is not on the board yet is put there, because its board row is
where the review is curated, and the button takes you to it. It posts nothing.
It comes back and waits, and the row opens on what it found: each finding with
its severity, the file and line it is about, and the fix it suggests.

The review is filed under the cat-factory service that backs the pull request's
repository, in the workspace that links it. A repository no workspace links yet
is linked and given a service of its own, which registers it here too, when the
key has the `admin` scope and there is one workspace to put it in. A repository
no service backs otherwise (a monorepo, say) goes under the default service the
org sets on the Configuration screen, and with none set the button offers a link
that adds it in cat-factory.

You are the gate. Tick the ones worth saying out loud (the blockers and the highs
start ticked), **Dismiss** the noise, and then choose:

- **Post inline** puts the selection on the pull request as review comments, on
  the lines they belong to. A finding whose line is outside the diff is folded
  into the summary comment rather than dropped.
- **Send to a fixer** hands the selection to an agent that commits onto the
  reviewed branch.
- **Finish without posting** closes the review having said nothing, which is the
  right answer more often than it sounds.

Not sure a finding is right? **Challenge** it, with your doubt or without one.
cat-factory sends an investigator back to the source behind that finding, and the
verdict lands on it: upheld, amended (with the new wording or severity), or
retracted, which unticks it and keeps it off the pull request. Each finding can
be challenged once, one at a time, and a review gets five, dismissed ones included.

Posting reports back. If seven comments went out and two bounced, the row says
which two and why, against the attempt number, and posting again skips what
already landed rather than commenting twice. And if the reviewer wedges with
every slice of the diff already in, **Resume** re-dispatches only the slices that
never reported, so a review that stalled on its last turn is not thrown away.

Opening the row reads cat-factory, and closing it stops. What does not stop is
the deployment's own clock: the same tick that sends the reminders asks after
every review still in flight, so one that parks while every board is closed is
already on the row when somebody next looks, rather than waiting to be
discovered. And it does not wait to be looked at: a review that parks is a nudge
like any other — the assigned reviewer's DM, or the channel while nobody owns
it — said once per park, and again if a post fails and re-parks it. A pull
request that has already been approved or closed is left alone.

Each run is a billed cat-factory job, so every way to ask for one (the button,
the label, `@bot ai`, `/review ai`) meets the same limit: one run in flight per
review, and no more than three filed on it in an hour.

## A guided review explains the change before you read it

**Guided review** sits beside every pull request on the workspace and the board.
It opens a page where cat-factory reads the change and lays it out: what it is
for, what changed, what it affects, the risks ranked by severity, and where to
look first, each pointing at the lines on the host at the commit it read.

From there you ask. A suggested question, or one of your own, opens a thread,
and every thread is answered on its own, so a slow one never holds up the rest.
**Dig into a checkout** sends the question to a read-only checkout of the whole
repository, for the ones the diff cannot answer ("where else is this called").
That answer takes minutes rather than seconds.

The page is live: it follows cat-factory's stream for the review, so the
overview, an answer and new drafts appear as they land, for everybody who has it
open. While the stream is down it re-reads on an interval instead.

**Draft comments** turns what a thread concluded into review comments anchored
on the diff. Edit them, move one to another line, discard the noise, and post
the rest: they go up as plain review comments from cat-factory, never as an
approval or a change request. A post reports per comment, and posting again
never duplicates one that landed. A pull request with commits past the reviewed
one refuses the post until the review is re-read at the latest commit, because
every anchor was computed against the old one.

There is one guided review per pull request on a deployment, and everybody who
opens it sees the same threads. Opening the page reads; only **Start a guided
review** spends model budget. It needs the same cat-factory key as the AI
review (the `write` scope is enough) and a base URL, both set per org on the
Configuration screen, but no service id: the repository has to be linked in a
cat-factory workspace, which with cat-factory configured is also what registers
it here (see [docs/integrations.md](./docs/integrations.md)). A key that reaches
several workspaces works too: the review opens in the workspace that links the
repository.

## Pull requests nobody needs to look at

A typo fix waits for a reviewer as long as a schema change does. Turn on a
**risk policy** (Configuration, Risk policy) and every pull request the board
tracks is scored from 0 to 1 on complexity, risk and impact, by cat-factory when
the org connected it and from the changed files when not. Then it is held to the
org's ceilings and to a rule per kind of change (documentation, tests, dependency
bumps, CI, code, migrations), or handed to one of the org's cat-factory risk
policies for its verdict.

A pull request within the policy can be approved with nobody looking, as the bot
account the org stored a token for (or the GitHub App), and only after a clean
AI review if the policy asks for one. New commits withdraw that approval and the
new head is assessed again. The board row says where each one stands and why.
See [docs/risk-policy.md](./docs/risk-policy.md).

## Asking for attention

A pull request that nobody has picked up is the thing the workspace exists to
fix. Press **Ask for attention** on one of yours and say what a reviewer needs:
which skills (from the project's own vocabulary, `Backend` and `Frontend` until
a team names its own), how many people you want, and whether the ask should stay
inside your team.

The dialog lists the five best matches as you pick, with what each one matched,
how many reviews they finished in the same repository over the last six months,
and how many they already have open beside their name. Past reviews are read
from GitHub or GitLab when a credential for the host is configured (a verdict on
one of the repository's 100 most recently updated pull requests), and from the
board's own finished reviews otherwise; each person gets the larger of the two
counts, since both describe the same history. They are ranked on how much of
those skills and the repository's domains a person holds, raised for those past
reviews, and open reviews only order people who rank equally on those: you can
see the load and weigh it yourself, and a busy expert still outranks an idle
stranger. Past reviews count with diminishing returns and never outweigh the
whole wanted mix, so the regular of a repository is preferred without being
handed every review in it. An automatic assignment draws with the same
preference, so the list and the router favour the same people. The list is the
people an ask could reach, so it never names you, the author, anybody already on
the pull request or paused, and it keeps to your team when the ask does.

Tick people in that list and the ask goes to them by name: exactly those
people, whatever skills they hold, and each of them sees who else was asked. It
can wait for no more people than it names. Tick nobody and the ask goes to
everyone available who holds at least half of what is wanted: the picked skills,
or the pull request's own when none are picked, and the repository's domains. It
stays inside your team if you said so, and an ask on a repository that wants
nothing in particular reaches everybody available. An ask that would reach
nobody because nobody available holds half of what it wants is refused, so you
can pick fewer skills or name people instead.
Either way anybody can still volunteer, because a skill list is not in a
position to overrule somebody's own judgement of what they can review.

The ask is delivered two ways at once. A page already open is pushed the
request over server-sent events; a page opened an hour later fetches the same
thing over REST. Neither is a fallback for the other, and both carry the same
payload.

A named ask also reaches each recipient who has a Slack id as a DM from the
org's Slack app: who asks, for which pull request, what of the ask they match,
and an **I will review it** button that commits exactly as the inbox does. The
DM follows the ask, so it says when you committed and closes when the ask is
answered or withdrawn, rather than leave a button on an ask that is over. An ask
nobody was named on is not sent as DMs, since it can reach the whole pool.

Anybody an ask reached can say **Not me**, in the inbox (with an optional
reason) or on the DM. The ask leaves their inbox and the requester sees who
passed and why, so a no is never mistaken for an unread ask. When declines leave
a named ask with fewer people to answer than it still waits for, it moves on to
the next best match from the same ranking the dialog showed, skipping everyone
already asked and the pull request's author. It does that by itself when you
left **If somebody declines, ask the next best match** ticked. Otherwise you get
a DM saying the ask is short, and **Ask the next best match** in your inbox asks
them. Somebody who declined and then volunteers after all is simply committed.

The ask ANSWERS ITSELF. Once enough people have said they will review, it is
resolved and disappears from everybody's inbox, including the people who never
got round to it. An ask that stayed up after it was answered would train the
team to ignore the next one.

## My PRs, and merging them

**My PRs** lists your ten most recently updated open pull requests: the ones you
authored, in the registered projects and in any other repository the host search
finds them in. By default it shows the ones still waiting on somebody else: not a
draft and not approved yet. Switch the status to **Approved** or **Drafts** to see
those instead, narrow it to one repository owner or one repository, or turn on
**Linked repositories only**. Each row reads its approval and merge state from the
host, GitHub or GitLab alike.

The search outside the registered projects runs with a credential that acts as a
person (a sign-in or a personal access token), because a GitHub App installation
reaches only the repositories it is installed on. A row from a repository nobody
registered is marked **Not linked**, and an admin links it with one click. Merging
waits until it is linked, since the repository's merge settings live on its project.

A pull request the host would merge right now gets a **Merge** button. It merges
with the method the repository allows, at the commit you were looking at, so one
that gained commits since you loaded the page is refused rather than merged.

An org that merges through a bot (a merge queue driven by `/merge`, say)
configures **merge comments**: a button label and the comment it posts. They are
set for the org on the Organization screen, and a team or a project can replace
them with its own list or with none. A project's list wins over its author's
team's, which wins over the org's. A project can also refuse direct merges while
merge comments are in force, so everything goes through the bot. An admin still
sees the merge button there and has to confirm the override.

Both actions use the deployment's credential for the host, so they only act on
a pull request you opened, and the host's own branch protection still applies.
A GitHub App needs `Contents: Read & write` to merge.

## My Reviews

**My Reviews** is the other side of My PRs: open pull requests somebody else
opened that you have a part in. It lists three things:

- **Asked to review**: the host is waiting on your review. "I will review it"
  records a commitment, which moves the pull request to the next list.
- **Committed to reviewing**: the promises you made here.
- **Reviewed**: still open, and you have reviewed them. One the host asks you to
  look at again moves back up to the first list.

A commitment, made here or by answering an ask, requests your review on the
host, so the pull request shows who took it. Releasing it takes that request
back only if the commitment made it and you have not reviewed yet: a request the
author or a board assignment made stays where it was.

Like My PRs, it covers every repository the host search can see, and **Linked
repositories only** narrows it to the registered projects. On GitLab, which keeps
no record of a review short of an approval, reviewed means approved.

## PRs to review

**PRs to review** answers "what should I pick up next" across the linked
repositories, whether or not anybody asked you. A pull request you committed to
and have not reviewed yet is listed first, oldest promise first. The rest are
ranked:

- longest without any review ranks highest, and one nobody committed to ranks
  higher than one somebody did;
- then the share of the repository's skills and domains you hold;
- then how active you were in the repository over the last six months, in
  reviews given and pull requests opened;
- and a request for your review on the host raises it.

The wait counts more than the fit, so a stranger's change that nobody has
looked at for days still outranks a fresh one in your own corner. Drafts, your
own pull requests and the ones you already reviewed are left out, unless the
host asks you to look again. Each row says why it is there.

Who reviewed what is read from the host (on GitLab, which records nothing short
of an approval, that is the approvers). When the host will not say, the pull
request is still listed and simply does not rank for its wait.

## Reports

**Reports** shows how long pull requests wait at each step of review: the first
review, the first human review (CodeRabbit, Copilot and the other bots left
out), the approval and the merge. Pick a window of 7 to 90 days, and either
every linked repository or one of them.

Each step gets its median, p90 and mean, and a count of the open pull requests
still waiting on it, so the slowest ones are not hidden by not having finished.
Across the whole org it names the **hotspots**: repositories whose median is
well behind the rest, and ones with several pull requests left waiting longer
than nearly anything else took. **People** shows who reviewed how many pull
requests (and approved them, or got there first), and how long the pull
requests each person opened waited for a review. Below that are the longest
waits for a human review, still open or not.

The history is read from GitHub and GitLab when you open the screen, so a
report covers time before this deployment existed. The same numbers can be
pushed to an OpenTelemetry collector as gauges, hourly, by setting
`OTEL_EXPORTER_OTLP_ENDPOINT`. See [docs/reporting.md](./docs/reporting.md).

## Who is in the pool

Both of those depend on the same list, and **Reviewers** is where it is kept: who
can be asked, what they know, and how much they should take.

A person carries a handle PER HOST, and the screen shows both, because a reviewer
with no handle on the host a project lives on is invisible in that project's
workspace and this is the only place that says so. Skills and domains are
matched one way everywhere: the share of what a review wants that a person
holds. The ranking sorts on it, the board's draw favours it without excluding
anybody, and an ask nobody was named on reaches whoever holds at least half.
Weight is the share of the load, for somebody part-time or ramping up.

Going heads-down is one click: **Pause** takes somebody out of every selection and
keeps their row, so they come back as themselves rather than being retyped. There
is no delete, for the same reason and one more: the row is what a review's
assignment and a signed-in host account point at.

With cat-factory configured, the pool follows its directory: every member of the
account is a reviewer, matched on their GitHub or GitLab account, and every
workspace is a team. Somebody it adds joins paused, until an admin gives them
skills and resumes them. Their name, handles and team are then set in cat-factory;
skills, domains, weight and availability stay here. See
[docs/integrations.md](./docs/integrations.md).

## Try it in one command

```bash
pnpm install
pnpm dev:local      # API on http://localhost:8788
pnpm dev:frontend   # SPA on http://localhost:3088
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
| `backend/packages/reporting`               | `@sainte-beuve/reporting`               | Review timings, statistics and hotspots (pure)                  |
| `backend/packages/telemetry`               | `@sainte-beuve/telemetry`               | The review metrics over OpenTelemetry (OTLP/HTTP)               |
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
[docs/auth.md](./docs/auth.md) for who is allowed to call it,
[docs/orgs.md](./docs/orgs.md) for what they may reach once they are in,
[docs/realtime.md](./docs/realtime.md) for how the attention stream is fanned
out, [docs/reporting.md](./docs/reporting.md) for what Reports measures and
exports, and [docs/performance-review.md](./docs/performance-review.md) for where it
will scale badly first.

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
endpoints under the same root. GitLab's webhook belongs to an org, like Slack's
app: it posts to `/webhooks/gitlab/<org>` with the secret token that org stored.

Slack needs a bot token to post, and separately a signing secret to trust the
`/review` command and the message buttons coming back. Both belong to an ORG
rather than to the deployment: one Slack app serves one tenancy, so its Request
URL carries the org's slug (`/webhooks/slack/<org>`, and the bare
`/webhooks/slack` for the default one) and a command is trusted only against the
secret that org stored. `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` and
`SLACK_CHANNEL_ID` describe this deployment's own Slack app, so all three stay
the default org's and none is lent to a named one — a deployment that never made
a second org changes nothing, and a second org connects its own app. Every URL
that has to be registered is shown on the Configuration screen with this
deployment's own base URL filled in. Full setup:
[docs/integrations.md](./docs/integrations.md).

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
NAMES, so a hosted SPA has to be listed in `CORS_ORIGINS`; and a sign-in builds
its OAuth callback on `API_BASE_URL`, the API's own public origin, which a hosted
deployment sets (a laptop on loopback need not). Full design:
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
  clock runs on a cron trigger, every five minutes.
- **Node.js service** ([deploy/node](./deploy/node/README.md)): the same clock on an
  interval, in a container, every minute by default (`REMINDER_INTERVAL_MS`).
- **SPA** ([deploy/frontend](./deploy/frontend/README.md)): a static Nuxt build on
  Cloudflare Pages, or any static host.

The board is durable on both: D1 on the Worker, Postgres on the Node service, one
schema and one suite behind them ([docs/persistence.md](./docs/persistence.md)). A
deployment that binds neither still boots, on a store a restart empties, and
`GET /health` reports which one it is on and whether it answers.

The live attention stream reaches the whole deployment on both, too: one process
is one bus on Node, and the Worker binds a Durable Object per org so an ask
raised on one isolate reaches the pages attached to every other
([docs/realtime.md](./docs/realtime.md)). A Worker that binds none still serves
the board — the REST inbox carries the same payload — and `/health` reports which
fan-out is in force.

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

# sainte-beuve

Centralized review solution to make reviews fun and easy.

Three jobs: find a reviewer who actually holds the skills a change needs, keep the
reminders honest, and hand the pull request to an AI reviewer when that is the faster
answer. GitHub is where a review starts; Slack is where the nudge arrives; the AI
review runs on a [cat-factory](https://github.com/kibertoad/cat-factory) instance,
local or centralized.

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

| Path                                  | Package                            | What it is                                                      |
| ------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `backend/packages/contracts`          | `@sainte-beuve/contracts`          | Valibot wire contracts, shared by the frontend and every facade |
| `backend/packages/kernel`             | `@sainte-beuve/kernel`             | Domain errors and port interfaces                               |
| `backend/packages/reviewers`          | `@sainte-beuve/reviewers`          | Reviewer selection (pure)                                       |
| `backend/packages/reminders`          | `@sainte-beuve/reminders`          | Reminder cadence and escalation (pure)                          |
| `backend/packages/integrations`       | `@sainte-beuve/integrations`       | GitHub and Slack adapters                                       |
| `backend/packages/ai-review`          | `@sainte-beuve/ai-review`          | The cat-factory gateway                                         |
| `backend/packages/persistence-memory` | `@sainte-beuve/persistence-memory` | In-memory repositories                                          |
| `backend/packages/server`             | `@sainte-beuve/server`             | The runtime-neutral Hono app                                    |
| `backend/runtimes/cloudflare`         | `@sainte-beuve/worker`             | Cloudflare Worker facade                                        |
| `backend/runtimes/node`               | `@sainte-beuve/node-server`        | Node.js service facade                                          |
| `backend/runtimes/local`              | `@sainte-beuve/local-server`       | Local-mode facade                                               |
| `frontend/app`                        | `@sainte-beuve/app`                | The Nuxt layer                                                  |
| `deploy/backend`                      | `@sainte-beuve/deploy-backend`     | Example Cloudflare Worker deployment                            |
| `deploy/node`                         | `@sainte-beuve/deploy-node`        | Example Node.js service deployment                              |
| `deploy/local`                        | `@sainte-beuve/deploy-local`       | Local mode                                                      |
| `deploy/frontend`                     | `@sainte-beuve/deploy-frontend`    | Example Cloudflare Pages deployment                             |

Read [docs/implementation-plan.md](./docs/implementation-plan.md) for what is built,
what is a placeholder, and what lands next.

## Hosting it

Both backends serve the same Hono app and the same routes; pick whichever matches
your infrastructure.

- **Cloudflare Worker** ([deploy/backend](./deploy/backend/README.md)): the reminder
  clock runs on a cron trigger.
- **Node.js service** ([deploy/node](./deploy/node/README.md)): the same clock on an
  interval, in a container.
- **SPA** ([deploy/frontend](./deploy/frontend/README.md)): a static Nuxt build on
  Cloudflare Pages, or any static host.

Persistence is in-memory today, on purpose (see the plan). Do not point a real team
at a hosted deployment until slice 5 lands.

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

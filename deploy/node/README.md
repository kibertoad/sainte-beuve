# Node.js deployment

The example long-running-service deployment of `@sainte-beuve/node-server`. `src/main.ts`
calls the library's `start()`; everything else here is configuration.

## Run it locally

```bash
cp .env.example .env   # optional: every value has a default or is optional
pnpm dev:node
```

Serves on `http://localhost:8788`. `GET /health` reports which optional capabilities
this process actually wired, and which store it is on.

Point `DATABASE_URL` at a Postgres and the board is durable; the schema is
applied at boot from the migrations that ship inside
`@sainte-beuve/persistence-postgres`, so there is no separate step to remember.
Leave it out and the process runs on an in-memory store that a restart empties,
and `/health` says `persistence: "memory"`. Bringing one up locally:

```bash
docker run --rm -p 5432:5432 -e POSTGRES_USER=sainte_beuve -e POSTGRES_PASSWORD=sainte_beuve -e POSTGRES_DB=sainte_beuve postgres:18
```

Set `SETTINGS_ENCRYPTION_KEY` (`openssl rand -base64 32`) for the SPA's Configuration
screen to be able to store credentials and start a connect flow, and keep it across
deploys: rotating it makes every credential sealed under it unreadable, which the
screen then says out loud.

`.env.example` lists every GitHub and Slack variable with what it is for. The three
GitHub credentials are not alternatives to choose between here: whichever are
configured are offered on the Configuration screen, and the strongest present is
used. Registering the URLs with GitHub and Slack is
[docs/integrations.md](../../docs/integrations.md).

## Deploy it

Build the image from the repo root (the Dockerfile's context is the whole workspace,
because the service resolves its libraries through the pnpm workspace):

```bash
docker build -f deploy/node/Dockerfile -t sainte-beuve-node .
docker run --env-file deploy/node/.env -p 8788:8788 sainte-beuve-node
```

A container deploy that gates schema changes on a human sets `DATABASE_MIGRATE=false`
and applies `POSTGRES_MIGRATIONS_DIR` itself. How the store is put together, and what
it costs to add a column, is [docs/persistence.md](../../docs/persistence.md).

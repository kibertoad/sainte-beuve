# Node.js deployment

The example long-running-service deployment of `@sainte-beuve/node-server`. `src/main.ts`
calls the library's `start()`; everything else here is configuration.

## Run it locally

```bash
cp .env.example .env   # optional: every value has a default or is optional
pnpm dev:node
```

Serves on `http://localhost:8788`. `GET /health` reports which optional capabilities
this process actually wired.

## Deploy it

Build the image from the repo root (the Dockerfile's context is the whole workspace,
because the service resolves its libraries through the pnpm workspace):

```bash
docker build -f deploy/node/Dockerfile -t sainte-beuve-node .
docker run --env-file deploy/node/.env -p 8788:8788 sainte-beuve-node
```

Persistence is in-memory today, so a restart loses the board. The Postgres adapter is
slice 5 of [the plan](../../docs/implementation-plan.md).

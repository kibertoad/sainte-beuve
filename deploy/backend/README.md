# Backend deployment (Cloudflare Worker)

The example Cloudflare deployment of `@sainte-beuve/worker`. `src/index.ts` re-exports
the library's handler; everything else here is configuration.

## Run it locally

```bash
pnpm dev:worker
```

Serves on `http://localhost:8787`. Copy `.dev.vars.example` to `.dev.vars` to attach
credentials; without them the Worker still boots and `/health` reports which
capabilities are off.

## Deploy it

1. Copy this package into your own repo (or keep it here and edit in place).
2. Create the database and apply the schema:

   ```bash
   wrangler d1 create sainte-beuve            # paste the id into wrangler.toml
   pnpm --filter @sainte-beuve/deploy-backend db:migrate
   ```

   The migrations ship inside `@sainte-beuve/persistence-d1`, and
   `migrations_dir` in wrangler.toml already points at the installed copy, so
   there is nothing to keep in step by hand. Without the binding the Worker
   still boots, on a store an isolate recycle empties, and `/health` reports
   `persistence: "memory"`.

3. Set the `[vars]` in `wrangler.toml` to your own origins and ids.
4. Set the secrets with `wrangler secret put <NAME>`; wrangler.toml lists every
   one and what it is for. `SETTINGS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
   is the one to set first and then keep: it seals the credentials entered on the
   Configuration screen and signs the connect round trips, and rotating it makes
   every credential stored under it unreadable.
5. Name the SPA's origin in `CORS_ORIGINS`. Reading the board is happy with `*`;
   writing is not, and neither is the Configuration screen nor an AI-review read,
   because a route that changes something — or spends this deployment's
   cat-factory key — is one any page the operator visits could otherwise call. A
   page on `http://localhost` is not an exception here: the wildcard names it only
   when the deployment is itself loopback, so an SPA you run locally against this
   Worker goes in the list too.
6. `pnpm --filter @sainte-beuve/deploy-backend deploy`
7. Register the Worker's URLs with GitHub and Slack. They are shown on the
   Configuration screen with this deployment's own base URL filled in, and the
   step-by-step is [docs/integrations.md](../../docs/integrations.md).

`pnpm dev:worker` runs against a local D1 that miniflare creates for you; apply
the schema to it once with
`pnpm --filter @sainte-beuve/deploy-backend db:migrate:local`. How the store is
put together, and what it costs to add a column, is
[docs/persistence.md](../../docs/persistence.md).

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
2. Set the `[vars]` in `wrangler.toml` to your own origins and ids.
3. Set the secrets: `wrangler secret put CAT_FACTORY_API_KEY`, and the same for
   `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`.
   Add `SETTINGS_ENCRYPTION_KEY` (`openssl rand -base64 32`) if the Configuration
   screen should be able to store credentials; keep it, because rotating it makes
   every token stored under it unreadable.
4. `pnpm --filter @sainte-beuve/deploy-backend deploy`

Persistence is in-memory today, so an isolate recycle loses the board. The D1 adapter
is slice 5 of [the plan](../../docs/implementation-plan.md); do not run this against a
real team until it lands.

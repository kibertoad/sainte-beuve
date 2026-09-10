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
3. Set the secrets with `wrangler secret put <NAME>`; wrangler.toml lists every
   one and what it is for. `SETTINGS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
   is the one to set first and then keep: it seals the credentials entered on the
   Configuration screen and signs the connect round trips, and rotating it makes
   every credential stored under it unreadable.
4. Name the SPA's origin in `CORS_ORIGINS`. The board is happy with `*`; the
   configuration routes are not, because a credential write reachable from any
   origin is one any page the operator visits can make.
5. `pnpm --filter @sainte-beuve/deploy-backend deploy`
6. Register the Worker's URLs with GitHub and Slack. They are shown on the
   Configuration screen with this deployment's own base URL filled in, and the
   step-by-step is [docs/integrations.md](../../docs/integrations.md).

Persistence is in-memory today, so an isolate recycle loses the board. The D1 adapter
is slice 5 of [the plan](../../docs/implementation-plan.md); do not run this against a
real team until it lands.

# Frontend deployment (Cloudflare Pages)

The example deployment of the `@sainte-beuve/app` Nuxt layer. `nuxt.config.ts` extends
the layer and sets the backend URL; there is no application code here on purpose.

## Run it locally

```bash
pnpm dev:frontend
```

Serves on `http://localhost:3000` against `http://localhost:8788` (the Node or
local-mode backend). Start one of those first, or the board shows the
"could not reach the API" state.

## Deploy it

```bash
NUXT_PUBLIC_API_BASE=https://api.sainte-beuve.example.com \
  pnpm --filter @sainte-beuve/deploy-frontend generate
pnpm --filter @sainte-beuve/deploy-frontend deploy
```

The API base is baked in at build time (`ssr: false`), so it is a build variable,
not a runtime one.

The backend has to name this deployment's own origin in `CORS_ORIGINS`. A board
served from an origin the API does not list still loads and reaches nothing, and the
origin has to be named even where reading the board works on `*`: the wildcard
covers reads, and every write plus the Configuration screen is excluded from it.

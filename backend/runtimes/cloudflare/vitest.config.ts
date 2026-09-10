import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// The Worker suite runs inside the real Workers runtime (workerd, the same engine
// wrangler ships), not in Node with a shim. That is the whole point of having it:
// a Node-only suite proves the Hono app works, which @sainte-beuve/server already
// proves, and says nothing about whether the code we deploy boots on the runtime we
// deploy it to.
export default defineConfig({
  plugins: [
    cloudflareTest({
      // No remote bindings: the suite must run offline, in CI, with no Cloudflare
      // account attached.
      remoteBindings: false,
      wrangler: { configPath: './wrangler.toml' },
      // A credential-encryption key for the suite only, never in wrangler.toml:
      // a key committed as a `[vars]` default is a key somebody deploys with.
      // With it set, the suite can prove the at-rest cipher runs on workerd's
      // own Web Crypto, which is the one adapter that ships INSIDE the bundle
      // rather than behind a network call.
      miniflare: {
        bindings: {
          SETTINGS_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
          // BLANK on purpose, which is the shape a copied `.dev.vars.example`
          // arrives in: every name is there with no value. A facade that read
          // these with `??` would hand the app an empty secret and an empty
          // label, and both fail somewhere that does not name them.
          GITHUB_WEBHOOK_SECRET: '',
          GITHUB_LABEL_REVIEW: '',
        },
      },
    }),
  ],
})

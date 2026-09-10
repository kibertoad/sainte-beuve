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
    }),
  ],
})

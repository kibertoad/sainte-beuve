import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// The D1 conformance suite runs inside workerd, against a real D1 database.
//
// A Node suite over a SQLite file would be faster and would prove the wrong
// thing: what has to hold is that the statements this adapter sends work on the
// engine the Worker deploys to, applied to the schema the deployment's own
// `wrangler d1 migrations apply` produces.
//
// The migrations are read HERE, in Node, and handed to the suite as a binding,
// because there is no filesystem inside the runtime. `applyD1Migrations` in the
// suite then applies exactly what a deployment would.
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)))

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
})

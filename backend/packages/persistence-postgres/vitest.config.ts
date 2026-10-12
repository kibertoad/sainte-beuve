import { defineConfig } from 'vitest/config'

// Every suite here boots PGlite (Postgres compiled to WASM) and applies the
// whole migration chain in `beforeAll`. That takes a few seconds alone, but CI
// runs every package's tests at once on a small runner, and under that load the
// boot overruns vitest's 10s hook default. The cost grows with each migration,
// so the limit is set for the boot rather than for a quick setup hook.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
  },
})

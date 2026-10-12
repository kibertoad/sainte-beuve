import { defineConfig } from 'vitest/config'

// Every suite boots PGlite and applies the whole migration chain in `beforeAll`,
// which overruns vitest's 10s hook default when CI runs every package's tests at once.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
  },
})

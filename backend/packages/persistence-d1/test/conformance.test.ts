import { applyD1Migrations, env } from 'cloudflare:test'
import { repositoryConformanceCases } from '@sainte-beuve/persistence-conformance'
import { beforeAll, beforeEach, describe, it } from 'vitest'
import { createD1Repositories, D1_TABLES } from '../src/index.js'

// The shared suite (@sainte-beuve/persistence-conformance), run against D1
// inside workerd. Every case here also runs against the in-memory store and
// against Postgres; a difference between the three is a bug in whichever one
// disagrees, which is the entire point of the file being three lines long.
//
// The schema comes from `migrations/`, applied exactly as
// `wrangler d1 migrations apply` would, so a column this adapter selects and
// the migration never created fails here rather than on somebody's deployment.

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
}

describe('D1 repositories', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    // Emptied between cases rather than rebuilt: the cases write fixed ids and
    // read whole lists back, and the binding is one database for the file.
    await env.DB.batch(D1_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
  })

  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createD1Repositories(env.DB))
    })
  }
})

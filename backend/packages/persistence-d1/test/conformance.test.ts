import { applyD1Migrations, type D1Migration, env } from 'cloudflare:test'
import {
  repositoryConformanceCases,
  storedRowConformanceCases,
} from '@sainte-beuve/persistence-conformance'
import { beforeAll, beforeEach, describe, it } from 'vitest'
import { createD1Repositories } from '../src/index.js'

// The shared suite (@sainte-beuve/persistence-conformance), run against D1
// inside workerd. Every case here also runs against the in-memory store and
// against Postgres; a difference between the three is a bug in whichever one
// disagrees, which is the entire point of the file being three lines long.
//
// The schema comes from `migrations/`, applied exactly as
// `wrangler d1 migrations apply` would, so a column this adapter selects and
// the migration never created fails here rather than on somebody's deployment.

// The bindings `vitest.config.ts` hands the suite, declared where the pool
// reads `env`'s type from. `Cloudflare.Env` is the extension point the runtime
// types name, and the declarations merge, so this adds to whatever a
// `wrangler types` run would generate rather than replacing it.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

/** wrangler's own bookkeeping, and SQLite's. Neither is this adapter's to empty. */
function isOurs(table: string): boolean {
  return table !== 'd1_migrations' && !table.startsWith('sqlite_') && !table.startsWith('_cf_')
}

describe('D1 repositories', () => {
  let tables: string[] = []

  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
    // Read from the database the migrations just built rather than listed here:
    // a tenth table added to a migration and forgotten in a constant would stop
    // being emptied between cases, and the cases inheriting each other's rows
    // read as a bug in the store.
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>()
    tables = results.map((row) => row.name).filter(isOurs)
  })

  beforeEach(async () => {
    // Emptied between cases rather than rebuilt: the cases write fixed ids and
    // read whole lists back, and the binding is one database for the file.
    await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
  })

  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createD1Repositories(env.DB))
    })
  }

  // The payload cases, which need a write BEHIND the adapter: every write path it
  // exposes typechecks against the current contract, so the only way to produce a
  // row from an older one is a statement of our own.
  for (const testCase of storedRowConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run({
        repositories: createD1Repositories(env.DB),
        writeRawReviewer: async (id, payload) => {
          await env.DB.prepare(
            'INSERT INTO reviewers (id, outstanding_reviews, created_at, data) VALUES (?, ?, ?, ?)',
          )
            .bind(id, 0, 1_000, JSON.stringify(payload))
            .run()
        },
      })
    })
  }
})

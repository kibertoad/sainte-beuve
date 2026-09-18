import { PGlite } from '@electric-sql/pglite'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import {
  repositoryConformanceCases,
  storedRowConformanceCases,
  tenancyConformanceCases,
} from '@sainte-beuve/persistence-conformance'
import { getTableName, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  createPostgresPersistence,
  POSTGRES_MIGRATIONS_DIR,
  type PostgresDatabase,
  schema,
} from '../src/index.js'

// The shared suite (@sainte-beuve/persistence-conformance), run against
// Postgres. Every case here also runs against the in-memory store and against
// D1; a difference between the three is a bug in whichever one disagrees.
//
// PGlite rather than a container: it is Postgres itself compiled to WASM, so
// the SQL Drizzle generates is executed by the real planner with the real
// types, and the suite needs no service in CI and no port on a laptop. What it
// does not prove is anything about node-postgres, which is why
// `connectPostgres` is thin enough to read.
//
// The schema is applied from the GENERATED migrations rather than pushed from
// `schema.ts`, so a column a store selects and `pnpm db:generate` never wrote
// out fails here instead of on a deployment.

const TABLES = Object.values(schema).map((table) => `"${getTableName(table)}"`)

let client: PGlite
let db: PostgresDatabase

beforeAll(async () => {
  client = new PGlite()
  // The concrete PGlite database for the migrator, which is typed against its
  // own driver, and the shared type for the stores, which are not allowed to
  // know which driver they got.
  const pglite = drizzle({ client })
  await migrate(pglite, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
  db = pglite
})

afterAll(async () => {
  await client.close()
})

describe('Postgres repositories', () => {
  beforeEach(async () => {
    // One database for the file, emptied between cases: the cases write fixed
    // ids and read whole lists back.
    await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(', ')}`))
  })

  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createPostgresPersistence(db).forOrg(DEFAULT_ORG_ID))
    })
  }

  // The boundary itself, which the cases above cannot see: they are written
  // against one org's repositories, and this store's isolation is an `org_id` in
  // every predicate and every primary key.
  for (const testCase of tenancyConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createPostgresPersistence(db))
    })
  }

  // The payload cases, which need a write BEHIND the store: every write path it
  // exposes typechecks against the current contract, so the only way to produce a
  // row from an older one is a statement of our own. Raw SQL rather than Drizzle,
  // because the column type is the thing under test and an insert through it would
  // parse the payload on the way in.
  for (const testCase of storedRowConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run({
        repositories: createPostgresPersistence(db).forOrg(DEFAULT_ORG_ID),
        orgs: createPostgresPersistence(db).orgs,
        writeRawReviewer: async (id, payload) => {
          await db.execute(
            sql`INSERT INTO reviewers (org_id, id, outstanding_reviews, created_at, data)
                VALUES (${DEFAULT_ORG_ID}, ${id}, 0, 1000, ${JSON.stringify(payload)}::jsonb)`,
          )
        },
        writeRawAiReviewRun: async (id, reviewId, payload) => {
          await db.execute(
            sql`INSERT INTO ai_review_runs
                  (org_id, id, review_id, status, requested_at, last_polled_at, data)
                VALUES (${DEFAULT_ORG_ID}, ${id}, ${reviewId}, 'awaiting_selection', 1000, NULL,
                        ${JSON.stringify(payload)}::jsonb)`,
          )
        },
        writeRawOrg: async (id, slug, payload) => {
          await db.execute(
            sql`INSERT INTO orgs (id, slug, created_at, data)
                VALUES (${id}, ${slug}, 1000, ${JSON.stringify(payload)}::jsonb)`,
          )
        },
      })
    })
  }
})

import { PGlite } from '@electric-sql/pglite'
import { repositoryConformanceCases } from '@sainte-beuve/persistence-conformance'
import { getTableName, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  createPostgresRepositories,
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
      await testCase.run(createPostgresRepositories(db))
    })
  }
})

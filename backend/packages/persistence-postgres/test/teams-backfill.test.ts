import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  createPostgresPersistence,
  POSTGRES_MIGRATIONS_DIR,
  type PostgresDatabase,
} from '../src/index.js'

// The teams migration turns the free-form team names already on reviewers into
// teams. The ids are the ones D1's `0008_teams.sql` derives for the same names.

const TEAMS_MIGRATION = join(
  POSTGRES_MIGRATIONS_DIR,
  '20261008230603_chilly_invaders',
  'migration.sql',
)

let client: PGlite
let db: PostgresDatabase

async function seedReviewer(orgId: string, id: string, createdAt: number, team: string | null) {
  await db.execute(
    sql`INSERT INTO reviewers (org_id, id, outstanding_reviews, created_at, data)
        VALUES (${orgId}, ${id}, 0, ${createdAt}, ${JSON.stringify({ id, team })}::jsonb)`,
  )
}

beforeAll(async () => {
  client = new PGlite()
  const pglite = drizzle({ client })
  await migrate(pglite, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
  db = pglite
  await seedReviewer(DEFAULT_ORG_ID, 'r1', 2_000, 'Platform')
  await seedReviewer(DEFAULT_ORG_ID, 'r2', 1_000, ' platform ')
  await seedReviewer(DEFAULT_ORG_ID, 'r3', 3_000, 'Payments')
  await seedReviewer(DEFAULT_ORG_ID, 'r4', 4_000, null)
  await seedReviewer(DEFAULT_ORG_ID, 'r5', 4_000, '  ')
  await seedReviewer('org-b', 'r1', 5_000, 'Platform')
  // The table already exists, so only the backfill statement is run again.
  const statements = (await readFile(TEAMS_MIGRATION, 'utf8')).split('--> statement-breakpoint')
  const backfill = statements.find((statement) => statement.includes('INSERT INTO "teams"'))
  if (backfill === undefined) throw new Error('the teams migration has no backfill')
  await db.execute(sql.raw(backfill))
})

afterAll(async () => {
  await client.close()
})

it('makes one ownerless team per distinct name, per org', async () => {
  const store = createPostgresPersistence(db)
  expect(await store.forOrg(DEFAULT_ORG_ID).teams.list()).toStrictEqual([
    {
      id: 'team_7061796d656e7473',
      name: 'Payments',
      ownerId: null,
      mergeComments: null,
      createdAt: 3_000,
    },
    {
      id: 'team_706c6174666f726d',
      name: 'Platform',
      ownerId: null,
      mergeComments: null,
      createdAt: 1_000,
    },
  ])
  expect(await store.forOrg('org-b').teams.list()).toStrictEqual([
    {
      id: 'team_706c6174666f726d',
      name: 'Platform',
      ownerId: null,
      mergeComments: null,
      createdAt: 5_000,
    },
  ])
})

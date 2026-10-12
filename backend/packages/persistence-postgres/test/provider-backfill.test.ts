import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

// The `review_requests_provider` migration adds `pr_provider` to a board that
// already has rows, so the rows are written against the schema before it and
// the migration is applied over them, the way a deployment upgrades.

const PROVIDER_MIGRATION = '20261012112526_review_requests_provider'

let client: PGlite
let db: PostgresDatabase
let earlier: string

function payload(id: string, provider: string | undefined) {
  const host = provider === 'gitlab' ? 'gitlab.com' : 'github.com'
  return {
    id,
    pullRequest: {
      provider,
      owner: 'platform',
      repo: 'api',
      number: 12,
      url: `https://${host}/platform/api/pull/12`,
    },
    title: `Review ${id}`,
    authorLogin: 'author',
    requiredSkills: [],
    priority: 'normal',
    status: 'approved',
    assignedReviewerIds: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    assignedAt: null,
    dueAt: null,
  }
}

async function seedReview(id: string, provider: string | undefined) {
  await db.execute(
    sql`INSERT INTO review_requests (org_id, id, status, pr_owner, pr_repo, pr_number, created_at, data)
        VALUES (${DEFAULT_ORG_ID}, ${id}, 'approved', 'platform', 'api', 12, 1000,
                ${JSON.stringify(payload(id, provider))}::jsonb)`,
  )
}

/** A migrations folder holding every migration that comes before the provider's. */
async function migrationsBeforeProvider(): Promise<string> {
  const names = (await readdir(POSTGRES_MIGRATIONS_DIR)).toSorted()
  if (!names.includes(PROVIDER_MIGRATION)) throw new Error(`${PROVIDER_MIGRATION} is missing`)
  const folder = await mkdtemp(join(tmpdir(), 'sainte-beuve-migrations-'))
  for (const name of names.filter((candidate) => candidate < PROVIDER_MIGRATION)) {
    await cp(join(POSTGRES_MIGRATIONS_DIR, name), join(folder, name), { recursive: true })
  }
  return folder
}

beforeAll(async () => {
  client = new PGlite()
  const pglite = drizzle({ client })
  db = pglite
  earlier = await migrationsBeforeProvider()
  await migrate(pglite, { migrationsFolder: earlier })
  await seedReview('rev-gh', 'github')
  await seedReview('rev-gl', 'gitlab')
  // A payload with no provider at all, which the backfill files under GitHub.
  await seedReview('rev-none', undefined)
  await migrate(pglite, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
})

afterAll(async () => {
  await client.close()
  await rm(earlier, { recursive: true, force: true })
})

it("backfills each row's host from its payload", async () => {
  const { rows } = await client.query<{ id: string; pr_provider: string }>(
    'SELECT id, pr_provider FROM review_requests ORDER BY id',
  )
  expect(rows).toStrictEqual([
    { id: 'rev-gh', pr_provider: 'github' },
    { id: 'rev-gl', pr_provider: 'gitlab' },
    { id: 'rev-none', pr_provider: 'github' },
  ])
})

it('finds a backfilled row by its host', async () => {
  const reviews = createPostgresPersistence(db).forOrg(DEFAULT_ORG_ID).reviews
  const key = { owner: 'platform', repo: 'api', number: 12 }
  expect((await reviews.getByPullRequest({ provider: 'gitlab', ...key }))?.id).toBe('rev-gl')
  const history = await reviews.listForRepository(
    { provider: 'gitlab', owner: 'platform', repo: 'api' },
    { status: ['approved'], since: 0, limit: 10 },
  )
  expect(history.map((row) => row.id)).toStrictEqual(['rev-gl'])
})

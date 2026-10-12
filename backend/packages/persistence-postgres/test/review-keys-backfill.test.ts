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

// The `review_requests_keys` migration rebuilds the keys of a board that already
// has rows, so the rows are written against the schema before it and the
// migration is applied over them, the way a deployment upgrades.

const KEYS_MIGRATION = '20261012113719_review_requests_keys'

let client: PGlite
let db: PostgresDatabase
let earlier: string

interface Seed {
  id: string
  provider: string | undefined
  owner: string
  repo: string
  number: number
}

function payload(seed: Seed) {
  const url =
    seed.provider === 'gitlab'
      ? `https://gitlab.com/${seed.owner}/${seed.repo}/-/merge_requests/${seed.number}`
      : `https://github.com/${seed.owner}/${seed.repo}/pull/${seed.number}`
  const { id, provider, owner, repo, number } = seed
  return {
    id,
    pullRequest: { provider, owner, repo, number, url },
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

async function seedReview(seed: Seed) {
  await db.execute(
    sql`INSERT INTO review_requests (org_id, id, status, pr_owner, pr_repo, pr_number, created_at, data)
        VALUES (${DEFAULT_ORG_ID}, ${seed.id}, 'approved', ${seed.owner}, ${seed.repo}, ${seed.number},
                1000, ${JSON.stringify(payload(seed))}::jsonb)`,
  )
}

/** A migrations folder holding every migration that comes before the keys'. */
async function migrationsBeforeKeys(): Promise<string> {
  const names = (await readdir(POSTGRES_MIGRATIONS_DIR)).toSorted()
  if (!names.includes(KEYS_MIGRATION)) throw new Error(`${KEYS_MIGRATION} is missing`)
  const folder = await mkdtemp(join(tmpdir(), 'sainte-beuve-migrations-'))
  for (const name of names.filter((candidate) => candidate < KEYS_MIGRATION)) {
    await cp(join(POSTGRES_MIGRATIONS_DIR, name), join(folder, name), { recursive: true })
  }
  return folder
}

beforeAll(async () => {
  client = new PGlite()
  const pglite = drizzle({ client })
  db = pglite
  earlier = await migrationsBeforeKeys()
  await migrate(pglite, { migrationsFolder: earlier })
  await seedReview({ id: 'rev-gh', provider: 'github', owner: 'Platform', repo: 'API', number: 12 })
  await seedReview({ id: 'rev-gl', provider: 'gitlab', owner: 'platform', repo: 'api', number: 12 })
  // A payload that names no host, which the backfill files under GitHub.
  await seedReview({
    id: 'rev-none',
    provider: undefined,
    owner: 'platform',
    repo: 'api',
    number: 13,
  })
  await migrate(pglite, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
})

afterAll(async () => {
  await client.close()
  await rm(earlier, { recursive: true, force: true })
})

it("backfills each row's keys from its host and its lowercased path", async () => {
  const { rows } = await client.query<{ id: string; pull_request_key: string; repo_key: string }>(
    'SELECT id, pull_request_key, repo_key FROM review_requests ORDER BY id',
  )
  expect(rows).toStrictEqual([
    { id: 'rev-gh', pull_request_key: 'github:platform/api#12', repo_key: 'github:platform/api' },
    { id: 'rev-gl', pull_request_key: 'gitlab:platform/api#12', repo_key: 'gitlab:platform/api' },
    { id: 'rev-none', pull_request_key: 'github:platform/api#13', repo_key: 'github:platform/api' },
  ])
})

it('finds a backfilled row by its host, whatever the case of its path', async () => {
  const reviews = createPostgresPersistence(db).forOrg(DEFAULT_ORG_ID).reviews
  const onGitLab = { provider: 'gitlab' as const, owner: 'platform', repo: 'api', number: 12 }
  expect((await reviews.getByPullRequest(onGitLab))?.id).toBe('rev-gl')
  const onGitHub = { provider: 'github' as const, owner: 'platform', repo: 'api', number: 12 }
  expect((await reviews.getByPullRequest(onGitHub))?.id).toBe('rev-gh')
  const history = await reviews.listForRepository(
    { provider: 'gitlab', owner: 'Platform', repo: 'API' },
    { status: ['approved'], since: 0, limit: 10 },
  )
  expect(history.map((row) => row.id)).toStrictEqual(['rev-gl'])
})

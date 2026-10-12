import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { POSTGRES_MIGRATIONS_DIR, type PostgresDatabase } from '../src/index.js'

// The `unique_commitments` migration folds the duplicate commitments a race
// already left before it builds its unique index, so the duplicates are written
// against the schema before it and the migration is applied over them.

const UNIQUE_MIGRATION = '20261012153000_unique_commitments'

let client: PGlite
let db: PostgresDatabase
let earlier: string

interface Seed {
  org?: string
  id: string
  reviewerId?: string
  key?: string
  createdAt?: number
  requestedHandle?: string | null
}

async function seedCommitment(seed: Seed) {
  const { org = 'org-a', id, reviewerId = 'r1', key = 'github:platform/api#12' } = seed
  const createdAt = seed.createdAt ?? 1_000
  const [hostAndPath = '', number = '0'] = key.split('#')
  const [provider = 'github', path = ''] = hostAndPath.split(':')
  const [owner = '', repo = ''] = path.split('/')
  const data = {
    id,
    reviewerId,
    pullRequest: {
      provider,
      owner,
      repo,
      number: Number(number),
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    },
    title: `Commitment ${id}`,
    attentionRequestId: null,
    requestedHandle: seed.requestedHandle ?? null,
    createdAt,
  }
  await db.execute(
    sql`INSERT INTO review_commitments (org_id, id, reviewer_id, pull_request_key, created_at, data)
        VALUES (${org}, ${id}, ${reviewerId}, ${key}, ${createdAt}, ${JSON.stringify(data)}::jsonb)`,
  )
}

async function migrationsBeforeUnique(): Promise<string> {
  const names = (await readdir(POSTGRES_MIGRATIONS_DIR)).toSorted()
  if (!names.includes(UNIQUE_MIGRATION)) throw new Error(`${UNIQUE_MIGRATION} is missing`)
  const folder = await mkdtemp(join(tmpdir(), 'sainte-beuve-migrations-'))
  for (const name of names.filter((candidate) => candidate < UNIQUE_MIGRATION)) {
    await cp(join(POSTGRES_MIGRATIONS_DIR, name), join(folder, name), { recursive: true })
  }
  return folder
}

beforeAll(async () => {
  client = new PGlite()
  const pglite = drizzle({ client })
  db = pglite
  earlier = await migrationsBeforeUnique()
  await migrate(pglite, { migrationsFolder: earlier })
  // The earliest of three keeps its place and takes the host request a later one holds.
  await seedCommitment({ id: 'kept', createdAt: 1_000 })
  await seedCommitment({ id: 'later', createdAt: 2_000, requestedHandle: 'kibertoad' })
  await seedCommitment({ id: 'latest', createdAt: 3_000, requestedHandle: 'other' })
  // A tie on the time is broken on the id.
  await seedCommitment({ id: 'tie-b', key: 'github:platform/api#13' })
  await seedCommitment({ id: 'tie-a', key: 'github:platform/api#13' })
  // A key spelled with case is the same pull request.
  await seedCommitment({ id: 'lower', key: 'github:platform/api#14', createdAt: 1_000 })
  await seedCommitment({ id: 'upper', key: 'github:Platform/API#14', createdAt: 2_000 })
  // Another host, another person, another org: none of them a duplicate.
  await seedCommitment({ id: 'gitlab', key: 'gitlab:platform/api#12' })
  await seedCommitment({ id: 'other-person', reviewerId: 'r2' })
  await seedCommitment({ id: 'other-org', org: 'org-b' })
  await migrate(pglite, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
})

afterAll(async () => {
  await client.close()
  await rm(earlier, { recursive: true, force: true })
})

it('keeps the earliest commitment per person and pull request', async () => {
  const { rows } = await client.query<{ org_id: string; id: string; pull_request_key: string }>(
    'SELECT org_id, id, pull_request_key FROM review_commitments ORDER BY org_id, id',
  )
  expect(rows).toStrictEqual([
    { org_id: 'org-a', id: 'gitlab', pull_request_key: 'gitlab:platform/api#12' },
    { org_id: 'org-a', id: 'kept', pull_request_key: 'github:platform/api#12' },
    { org_id: 'org-a', id: 'lower', pull_request_key: 'github:platform/api#14' },
    { org_id: 'org-a', id: 'other-person', pull_request_key: 'github:platform/api#12' },
    { org_id: 'org-a', id: 'tie-a', pull_request_key: 'github:platform/api#13' },
    { org_id: 'org-b', id: 'other-org', pull_request_key: 'github:platform/api#12' },
  ])
})

it('hands the earliest the host request a dropped duplicate held', async () => {
  const { rows } = await client.query<{ handle: string | null }>(
    `SELECT data->>'requestedHandle' AS handle FROM review_commitments WHERE id = 'kept'`,
  )
  expect(rows).toStrictEqual([{ handle: 'kibertoad' }])
})

it('refuses a second commitment on the same key', async () => {
  await expect(seedCommitment({ id: 'again', createdAt: 5_000 })).rejects.toThrow()
})

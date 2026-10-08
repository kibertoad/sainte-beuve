import { applyD1Migrations, env } from 'cloudflare:test'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { beforeAll, expect, it } from 'vitest'
import { createD1Store } from '../src/index.js'

// `0008_teams.sql` turns the free-form team names already on reviewers into
// teams. The ids are the ones the Postgres migration derives for the same names.

async function seedReviewer(orgId: string, id: string, createdAt: number, team: string | null) {
  await env.DB.prepare(
    'INSERT INTO reviewers (org_id, id, outstanding_reviews, created_at, data) VALUES (?, ?, 0, ?, ?)',
  )
    .bind(orgId, id, createdAt, JSON.stringify({ id, team }))
    .run()
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await seedReviewer(DEFAULT_ORG_ID, 'r1', 2_000, 'Platform')
  await seedReviewer(DEFAULT_ORG_ID, 'r2', 1_000, ' platform ')
  await seedReviewer(DEFAULT_ORG_ID, 'r3', 3_000, 'Payments')
  await seedReviewer(DEFAULT_ORG_ID, 'r4', 4_000, null)
  await seedReviewer(DEFAULT_ORG_ID, 'r5', 4_000, '  ')
  await seedReviewer('org-b', 'r1', 5_000, 'Platform')
  const teams = env.TEST_MIGRATIONS.find((migration) => migration.name.startsWith('0008'))
  if (teams === undefined) throw new Error('0008_teams.sql is missing')
  // Every statement in it is idempotent, so running it again is the backfill alone.
  await env.DB.batch(teams.queries.map((query) => env.DB.prepare(query)))
})

it('makes one ownerless team per distinct name, per org', async () => {
  const store = createD1Store(env.DB)
  expect(await store.forOrg(DEFAULT_ORG_ID).teams.list()).toStrictEqual([
    { id: 'team_7061796d656e7473', name: 'Payments', ownerId: null, createdAt: 3_000 },
    { id: 'team_706c6174666f726d', name: 'Platform', ownerId: null, createdAt: 1_000 },
  ])
  expect(await store.forOrg('org-b').teams.list()).toStrictEqual([
    { id: 'team_706c6174666f726d', name: 'Platform', ownerId: null, createdAt: 5_000 },
  ])
})

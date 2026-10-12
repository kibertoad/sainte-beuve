import { applyD1Migrations, env } from 'cloudflare:test'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { beforeAll, expect, it } from 'vitest'
import { createD1Store } from '../src/index.js'

// `0011_review_requests_provider.sql` adds `pr_provider` to a board that already
// has rows, so the rows are written against the schema before it and the
// migration is applied over them, the way a deployment upgrades.

const PROVIDER_MIGRATION = '0011'

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
  await env.DB.prepare(
    `INSERT INTO review_requests (org_id, id, status, pr_owner, pr_repo, pr_number, created_at, data)
     VALUES (?, ?, 'approved', 'platform', 'api', 12, 1000, ?)`,
  )
    .bind(DEFAULT_ORG_ID, id, JSON.stringify(payload(id, provider)))
    .run()
}

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < PROVIDER_MIGRATION)
  if (before.length === env.TEST_MIGRATIONS.length) {
    throw new Error(`${PROVIDER_MIGRATION}_review_requests_provider.sql is missing`)
  }
  await applyD1Migrations(env.DB, before)
  await seedReview('rev-gh', 'github')
  await seedReview('rev-gl', 'gitlab')
  // A payload with no provider at all, which the backfill files under GitHub.
  await seedReview('rev-none', undefined)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

it("backfills each row's host from its payload", async () => {
  const { results } = await env.DB.prepare(
    'SELECT id, pr_provider FROM review_requests ORDER BY id',
  ).all<{ id: string; pr_provider: string }>()
  expect(results).toStrictEqual([
    { id: 'rev-gh', pr_provider: 'github' },
    { id: 'rev-gl', pr_provider: 'gitlab' },
    { id: 'rev-none', pr_provider: 'github' },
  ])
})

it('finds a backfilled row by its host', async () => {
  const reviews = createD1Store(env.DB).forOrg(DEFAULT_ORG_ID).reviews
  const key = { owner: 'platform', repo: 'api', number: 12 }
  expect((await reviews.getByPullRequest({ provider: 'gitlab', ...key }))?.id).toBe('rev-gl')
  const history = await reviews.listForRepository(
    { provider: 'gitlab', owner: 'platform', repo: 'api' },
    { status: ['approved'], since: 0, limit: 10 },
  )
  expect(history.map((row) => row.id)).toStrictEqual(['rev-gl'])
})

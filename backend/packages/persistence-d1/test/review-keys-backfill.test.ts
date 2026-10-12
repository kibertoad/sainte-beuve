import { applyD1Migrations, env } from 'cloudflare:test'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { beforeAll, expect, it } from 'vitest'
import { createD1Store } from '../src/index.js'

// `0012_review_requests_keys.sql` rebuilds a board that already has rows, so the
// rows are written against the schema before it and the migration is applied
// over them, the way a deployment upgrades.

const KEYS_MIGRATION = '0012'

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
  await env.DB.prepare(
    `INSERT INTO review_requests (org_id, id, status, pr_owner, pr_repo, pr_number, created_at, data)
     VALUES (?, ?, 'approved', ?, ?, ?, 1000, ?)`,
  )
    .bind(
      DEFAULT_ORG_ID,
      seed.id,
      seed.owner,
      seed.repo,
      seed.number,
      JSON.stringify(payload(seed)),
    )
    .run()
}

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < KEYS_MIGRATION)
  if (before.length === env.TEST_MIGRATIONS.length) {
    throw new Error(`${KEYS_MIGRATION}_review_requests_keys.sql is missing`)
  }
  await applyD1Migrations(env.DB, before)
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
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

it("backfills each row's keys from its host and its lowercased path", async () => {
  const { results: rows } = await env.DB.prepare(
    'SELECT id, pull_request_key, repo_key FROM review_requests ORDER BY id',
  ).all<{ id: string; pull_request_key: string; repo_key: string }>()
  expect(rows).toStrictEqual([
    { id: 'rev-gh', pull_request_key: 'github:platform/api#12', repo_key: 'github:platform/api' },
    { id: 'rev-gl', pull_request_key: 'gitlab:platform/api#12', repo_key: 'gitlab:platform/api' },
    { id: 'rev-none', pull_request_key: 'github:platform/api#13', repo_key: 'github:platform/api' },
  ])
})

it('finds a backfilled row by its host, whatever the case of its path', async () => {
  const reviews = createD1Store(env.DB).forOrg(DEFAULT_ORG_ID).reviews
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

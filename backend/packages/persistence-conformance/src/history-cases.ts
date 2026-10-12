import assert from 'node:assert/strict'
import type { ProjectRef } from '@sainte-beuve/contracts'
import type { ConformanceCase } from './case.js'
import { conformanceCase } from './case.js'
import { pullRequest, review } from './fixtures.js'

const API: ProjectRef = { provider: 'github', owner: 'platform', repo: 'api' }

/** One repository's review history: what a reviewer's familiarity is counted from. */
export const reviewHistoryCases: readonly ConformanceCase[] = [
  conformanceCase(
    "lists one repository's reviews in the named statuses, newest first",
    async (repos) => {
      // `rev-4` shares a millisecond with `rev-3`, so the id has to break the tie
      // the same way on every store, and `rev-5` is still running.
      await repos.reviews.create(review('rev-1', { status: 'approved', createdAt: 1_000 }))
      await repos.reviews.create(review('rev-3', { status: 'approved', createdAt: 3_000 }))
      await repos.reviews.create(review('rev-2', { status: 'changes_requested', createdAt: 2_000 }))
      await repos.reviews.create(review('rev-4', { status: 'approved', createdAt: 3_000 }))
      await repos.reviews.create(review('rev-5', { status: 'assigned', createdAt: 4_000 }))
      const rows = await repos.reviews.listForRepository(API, {
        status: ['approved', 'changes_requested'],
        since: 0,
        limit: 10,
      })
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        ['rev-4', 'rev-3', 'rev-2', 'rev-1'],
      )
    },
  ),

  conformanceCase(
    'a repository history leaves out other repositories and other hosts',
    async (repos) => {
      // The same owner and repo on GitLab is another repository: its reviews say
      // nothing about who knows the GitHub one.
      await repos.reviews.create(review('rev-1', { status: 'approved' }))
      await repos.reviews.create(
        review('rev-2', { status: 'approved', pullRequest: pullRequest({ repo: 'web' }) }),
      )
      await repos.reviews.create(
        review('rev-3', { status: 'approved', pullRequest: pullRequest({ provider: 'gitlab' }) }),
      )
      const rows = await repos.reviews.listForRepository(API, {
        status: ['approved'],
        since: 0,
        limit: 10,
      })
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        ['rev-1'],
      )
    },
  ),

  conformanceCase('a repository history matches its path whatever the case', async (repos) => {
    await repos.reviews.create(
      review('rev-1', {
        status: 'approved',
        pullRequest: pullRequest({ owner: 'Platform', repo: 'API' }),
      }),
    )
    const rows = await repos.reviews.listForRepository(API, {
      status: ['approved'],
      since: 0,
      limit: 10,
    })
    assert.deepStrictEqual(
      rows.map((row) => row.id),
      ['rev-1'],
    )
  }),

  conformanceCase('a repository history starts at `since` and stops at the cap', async (repos) => {
    await repos.reviews.create(review('rev-1', { status: 'approved', createdAt: 1_000 }))
    await repos.reviews.create(review('rev-2', { status: 'approved', createdAt: 2_000 }))
    await repos.reviews.create(review('rev-3', { status: 'approved', createdAt: 3_000 }))
    await repos.reviews.create(review('rev-4', { status: 'approved', createdAt: 4_000 }))
    const recent = await repos.reviews.listForRepository(API, {
      status: ['approved'],
      since: 2_000,
      limit: 2,
    })
    assert.deepStrictEqual(
      recent.map((row) => row.id),
      ['rev-4', 'rev-3'],
    )
    const all = await repos.reviews.listForRepository(API, {
      status: ['approved'],
      since: 2_000,
      limit: 10,
    })
    assert.deepStrictEqual(
      all.map((row) => row.id),
      ['rev-4', 'rev-3', 'rev-2'],
    )
  }),

  conformanceCase('a repository history naming no status matches nothing', async (repos) => {
    await repos.reviews.create(review('rev-1', { status: 'approved' }))
    const rows = await repos.reviews.listForRepository(API, { status: [], since: 0, limit: 10 })
    assert.deepStrictEqual(rows, [])
  }),
]

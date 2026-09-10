import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { reviewer } from './fixtures.js'

/**
 * The reviewer directory.
 *
 * Three of these are about the store's edges rather than its happy path, and
 * they are the ones a durable adapter is most likely to get wrong: a read must
 * be a COPY (a caller that mutates what it got back must not rewrite the
 * store), `adjustOutstanding` must accumulate rather than overwrite, and no
 * other write may touch the counter at all, because two assignments landing
 * together both count.
 */
export const reviewerCases: readonly ConformanceCase[] = [
  conformanceCase('a reviewer comes back with every field it was written with', async (repos) => {
    const written = reviewer('r1', { skills: ['payments', 'typescript'], weight: 0.5 })
    assert.deepStrictEqual(await repos.reviewers.create(written), written)
    assert.deepStrictEqual(await repos.reviewers.getById('r1'), written)
  }),

  conformanceCase('a reviewer that is not there reads as null', async (repos) => {
    assert.strictEqual(await repos.reviewers.getById('nobody'), null)
  }),

  conformanceCase('lists the directory oldest first, ties on the id', async (repos) => {
    // The ORDER is asserted rather than sorted away, and `r0` shares a
    // millisecond with `r1` on purpose. `ReviewService` hands this list
    // straight to `scoreCandidates`, and the draw walks the weights
    // positionally: a store that answered in insertion order would pick a
    // different person from the same random number than the hosted ones do.
    await repos.reviewers.create(reviewer('r3', { createdAt: 3_000 }))
    await repos.reviewers.create(reviewer('r1', { createdAt: 1_000 }))
    await repos.reviewers.create(reviewer('r2', { createdAt: 2_000 }))
    await repos.reviewers.create(reviewer('r0', { createdAt: 1_000 }))
    const ids = (await repos.reviewers.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['r0', 'r1', 'r2', 'r3'])
  }),

  conformanceCase('a caller cannot rewrite the store by mutating a read', async (repos) => {
    await repos.reviewers.create(reviewer('r1', { skills: ['typescript'] }))
    const read = await repos.reviewers.getById('r1')
    read?.skills.push('rust')
    assert.deepStrictEqual((await repos.reviewers.getById('r1'))?.skills, ['typescript'])
  }),

  conformanceCase('a caller cannot rewrite the store by mutating a patch', async (repos) => {
    await repos.reviewers.create(reviewer('r1'))
    const skills = ['typescript']
    await repos.reviewers.update('r1', { skills })
    skills.push('rust')
    assert.deepStrictEqual((await repos.reviewers.getById('r1'))?.skills, ['typescript'])
  }),

  conformanceCase('a patch touches the fields it names and no others', async (repos) => {
    await repos.reviewers.create(reviewer('r1', { team: 'platform', weight: 1 }))
    const updated = await repos.reviewers.update('r1', { availability: 'paused', weight: 0.25 })
    assert.strictEqual(updated?.availability, 'paused')
    assert.strictEqual(updated?.weight, 0.25)
    assert.strictEqual(updated?.team, 'platform')
    assert.strictEqual(updated?.displayName, 'Reviewer r1')
  }),

  conformanceCase('a patch cannot move a row to another id', async (repos) => {
    await repos.reviewers.create(reviewer('r1'))
    const updated = await repos.reviewers.update('r1', { id: 'r2' })
    assert.strictEqual(updated?.id, 'r1')
    assert.strictEqual(await repos.reviewers.getById('r2'), null)
  }),

  conformanceCase('patching a reviewer that is not there answers null', async (repos) => {
    assert.strictEqual(await repos.reviewers.update('nobody', { weight: 2 }), null)
  }),

  conformanceCase('the outstanding counter accumulates rather than overwrites', async (repos) => {
    await repos.reviewers.create(reviewer('r1'))
    await repos.reviewers.adjustOutstanding('r1', 1)
    await repos.reviewers.adjustOutstanding('r1', 2)
    await repos.reviewers.adjustOutstanding('r1', -1)
    assert.strictEqual((await repos.reviewers.getById('r1'))?.outstandingReviews, 2)
    assert.strictEqual((await repos.reviewers.list())[0]?.outstandingReviews, 2)
  }),

  conformanceCase('the outstanding counter floors at zero', async (repos) => {
    // A review resolved twice (a webhook replay, a Slack button pressed after
    // the approval landed) must not leave a reviewer owing minus one review,
    // which would make selection prefer them for ever.
    await repos.reviewers.create(reviewer('r1', { outstandingReviews: 1 }))
    await repos.reviewers.adjustOutstanding('r1', -5)
    assert.strictEqual((await repos.reviewers.getById('r1'))?.outstandingReviews, 0)
  }),

  conformanceCase('adjusting a reviewer that is not there does nothing', async (repos) => {
    await repos.reviewers.adjustOutstanding('nobody', 1)
    assert.deepStrictEqual(await repos.reviewers.list(), [])
  }),

  conformanceCase('a write after an adjustment keeps the counter', async (repos) => {
    // The counter is a column in both durable stores and a field in the payload
    // beside it. A patch that rewrote the payload from a stale read would walk
    // the count backwards.
    await repos.reviewers.create(reviewer('r1'))
    await repos.reviewers.adjustOutstanding('r1', 3)
    await repos.reviewers.update('r1', { displayName: 'Renamed' })
    assert.strictEqual((await repos.reviewers.getById('r1'))?.outstandingReviews, 3)
  }),

  conformanceCase('only an adjustment moves the counter', async (repos) => {
    // The shape of two requests overlapping: a patch carries the count that was
    // read before an assignment landed, and writing it would discard the
    // assignment. The counter belongs to `adjustOutstanding` alone, so a patch
    // naming it is ignored exactly as one naming the id is.
    await repos.reviewers.create(reviewer('r1'))
    await repos.reviewers.adjustOutstanding('r1', 1)
    const updated = await repos.reviewers.update('r1', {
      outstandingReviews: 0,
      displayName: 'Renamed',
    })
    assert.strictEqual(updated?.outstandingReviews, 1)
    assert.strictEqual(updated?.displayName, 'Renamed')
    assert.strictEqual((await repos.reviewers.getById('r1'))?.outstandingReviews, 1)
  }),
]

import assert from 'node:assert/strict'
import type { AttentionRequest } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { attentionRequest } from './fixtures.js'

/** A change that adds one person's commitment to whatever the ask holds when it runs. */
function commitBy(reviewerId: string) {
  return (current: AttentionRequest) => ({
    commitments: [
      ...current.commitments,
      { reviewerId, displayName: reviewerId, committedAt: 3_000 },
    ],
  })
}

/** Answering an ask: a change to what is stored, which two answers can make at once. */
export const attentionChangeCases: readonly ConformanceCase[] = [
  conformanceCase('an ask records the people who answered it', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    const updated = await repos.attention.change('a1', (current) => ({
      commitments: [
        ...current.commitments,
        { reviewerId: 'r1', displayName: 'One', committedAt: 3_000 },
      ],
      status: 'resolved',
      resolvedAt: 3_000,
    }))
    assert.strictEqual(updated?.commitments.length, 1)
    assert.strictEqual(updated?.status, 'resolved')
    assert.deepStrictEqual(await repos.attention.getById('a1'), updated)
    assert.deepStrictEqual(await repos.attention.list({ status: ['open'] }), [])
  }),

  conformanceCase('changing an ask that is not there answers null', async (repos) => {
    assert.strictEqual(
      await repos.attention.change('nobody', () => ({ status: 'cancelled' })),
      null,
    )
  }),

  conformanceCase('a change that writes nothing answers the ask as stored', async (repos) => {
    const written = attentionRequest('a1')
    await repos.attention.create(written)
    assert.deepStrictEqual(await repos.attention.change('a1', () => null), written)
    assert.deepStrictEqual(await repos.attention.getById('a1'), written)
  }),

  conformanceCase('a change that refuses leaves the ask as it was', async (repos) => {
    const written = attentionRequest('a1')
    await repos.attention.create(written)
    await assert.rejects(
      repos.attention.change('a1', () => {
        throw new Error('refused')
      }),
      /refused/,
    )
    assert.deepStrictEqual(await repos.attention.getById('a1'), written)
  }),

  conformanceCase('answers landing together are all kept', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    await Promise.all(['r1', 'r2', 'r3'].map((id) => repos.attention.change('a1', commitBy(id))))
    const stored = await repos.attention.getById('a1')
    const who = stored?.commitments.map((entry) => entry.reviewerId).toSorted()
    assert.deepStrictEqual(who, ['r1', 'r2', 'r3'])
  }),

  conformanceCase('a change after a fresh create starts from the new ask', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    await repos.attention.change('a1', commitBy('r1'))
    await repos.attention.create(attentionRequest('a1', { note: 'raised again' }))
    const updated = await repos.attention.change('a1', commitBy('r2'))
    assert.strictEqual(updated?.note, 'raised again')
    assert.deepStrictEqual(
      updated?.commitments.map((entry) => entry.reviewerId),
      ['r2'],
    )
  }),
]

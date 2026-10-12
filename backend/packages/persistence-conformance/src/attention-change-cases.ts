import assert from 'node:assert/strict'
import type { AttentionRequest } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { attentionRequest } from './fixtures.js'

type AttentionChange = (current: AttentionRequest) => Partial<AttentionRequest> | null

const committed = (reviewerId: string) => ({
  reviewerId,
  displayName: reviewerId,
  committedAt: 3_000,
})
const declined = (reviewerId: string) => ({
  reviewerId,
  displayName: reviewerId,
  reason: null,
  declinedAt: 3_000,
})
const named = (reviewerId: string) => ({ reviewerId, displayName: reviewerId })
const delivered = (reviewerId: string) => ({
  reviewerId,
  conversationId: `D-${reviewerId}`,
  messageId: `${reviewerId}.1`,
})

/** Each change adds one person to whatever the list holds when it runs. */
const commitBy =
  (id: string): AttentionChange =>
  (current) => ({
    commitments: [...current.commitments, committed(id)],
  })
const declineBy =
  (id: string): AttentionChange =>
  (current) => ({
    declines: [...current.declines, declined(id)],
  })
const ask =
  (id: string): AttentionChange =>
  (current) => ({
    recipients: [...current.recipients, named(id)],
  })
const deliverTo =
  (id: string): AttentionChange =>
  (current) => ({
    chatDeliveries: [...current.chatDeliveries, delivered(id)],
  })

const reviewerIds = (entries: readonly { reviewerId: string }[] | undefined) =>
  entries?.map((entry) => entry.reviewerId).toSorted()

/**
 * Answers that grow one list on the ask, raced against each other. Each pair
 * names the same field, which is the race a field-by-field write cannot keep.
 */
const sameFieldRaces: readonly {
  what: string
  change: (id: string) => AttentionChange
  read: (stored: AttentionRequest | null) => readonly { reviewerId: string }[] | undefined
}[] = [
  { what: 'commitments', change: commitBy, read: (stored) => stored?.commitments },
  { what: 'declines', change: declineBy, read: (stored) => stored?.declines },
  { what: 'people asked', change: ask, read: (stored) => stored?.recipients },
  { what: 'recorded DMs', change: deliverTo, read: (stored) => stored?.chatDeliveries },
]

const raceCases = sameFieldRaces.map((race) =>
  conformanceCase(`${race.what} landing together are all kept`, async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    await Promise.all(['r1', 'r2', 'r3'].map((id) => repos.attention.change('a1', race.change(id))))
    const stored = await repos.attention.getById('a1')
    assert.deepStrictEqual(reviewerIds(race.read(stored)), ['r1', 'r2', 'r3'])
  }),
)

/** Answering an ask: a change to what is stored, which two answers can make at once. */
export const attentionChangeCases: readonly ConformanceCase[] = [
  conformanceCase('an ask records the people who answered it', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    const updated = await repos.attention.change('a1', (current) => ({
      ...commitBy('r1')(current),
      status: 'resolved',
      resolvedAt: 3_000,
    }))
    assert.strictEqual(updated?.commitments.length, 1)
    assert.strictEqual(updated?.status, 'resolved')
    assert.deepStrictEqual(await repos.attention.getById('a1'), updated)
    assert.deepStrictEqual(await repos.attention.list({ status: ['open'] }), [])
    assert.deepStrictEqual(await repos.attention.list({ status: ['resolved'] }), [updated])
  }),

  conformanceCase('an ask keeps where its DMs landed through a later change', async (repos) => {
    const chatDeliveries = [delivered('r1')]
    await repos.attention.create(attentionRequest('a1', { chatDeliveries }))
    await repos.attention.change('a1', () => ({ status: 'resolved', resolvedAt: 2_000 }))
    assert.deepStrictEqual((await repos.attention.getById('a1'))?.chatDeliveries, chatDeliveries)
  }),

  conformanceCase(
    'an ask keeps who declined it, whether it asks on and who the host lists',
    async (repos) => {
      const people = { authorLogin: 'octo', requestedReviewerLogins: ['hubot'] }
      await repos.attention.create(attentionRequest('a1', { keepAsking: true, people }))
      const declines = [{ ...declined('r1'), reason: 'On leave' }]
      await repos.attention.change('a1', () => ({ declines, updatedAt: 2_000 }))
      const stored = await repos.attention.getById('a1')
      assert.deepStrictEqual(stored?.declines, declines)
      assert.strictEqual(stored?.keepAsking, true)
      assert.deepStrictEqual(stored?.people, people)
    },
  ),

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

  ...raceCases,

  conformanceCase('different answers landing together are all kept', async (repos) => {
    await repos.attention.create(attentionRequest('a1', { neededCommitments: 2 }))
    await Promise.all([
      repos.attention.change('a1', commitBy('r1')),
      repos.attention.change('a1', declineBy('r2')),
      repos.attention.change('a1', ask('r3')),
      repos.attention.change('a1', deliverTo('r3')),
    ])
    const stored = await repos.attention.getById('a1')
    assert.deepStrictEqual(reviewerIds(stored?.commitments), ['r1'])
    assert.deepStrictEqual(reviewerIds(stored?.declines), ['r2'])
    assert.deepStrictEqual(reviewerIds(stored?.recipients), ['r3'])
    assert.deepStrictEqual(reviewerIds(stored?.chatDeliveries), ['r3'])
  }),

  conformanceCase('a change after a fresh create starts from the new ask', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    await repos.attention.change('a1', commitBy('r1'))
    await repos.attention.create(attentionRequest('a1', { note: 'raised again' }))
    const updated = await repos.attention.change('a1', commitBy('r2'))
    assert.strictEqual(updated?.note, 'raised again')
    assert.deepStrictEqual(reviewerIds(updated?.commitments), ['r2'])
  }),
]

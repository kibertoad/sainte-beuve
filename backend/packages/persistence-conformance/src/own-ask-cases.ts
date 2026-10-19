import assert from 'node:assert/strict'
import type { AttentionRecipient, AttentionRequest } from '@sainte-beuve/contracts'
import type { Repositories } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { type ConformanceCase, conformanceCase } from './case.js'
import { attentionRequest, pullRequest } from './fixtures.js'

const named = (...ids: string[]): AttentionRecipient[] =>
  ids.map((reviewerId) => ({ reviewerId, displayName: reviewerId }))

const own = (id: string, overrides: Partial<AttentionRequest> = {}) =>
  attentionRequest(id, { recipients: named('r1'), ...overrides })

const openIds = async (repos: Repositories) =>
  (await repos.attention.list({ status: ['open'] })).map((row) => row.id)

/**
 * What a submit from My PRs does: open the ask, or add its people to the one
 * already open, against the people the stored ask holds when the change runs.
 */
async function submit(repos: Repositories, ask: AttentionRequest): Promise<void> {
  const { request, created } = await repos.attention.createOrGetOwn(ask)
  if (created) return
  await repos.attention.change(request.id, (current) => {
    const taken = new Set(current.recipients.map((entry) => entry.reviewerId))
    const added = ask.recipients.filter((entry) => !taken.has(entry.reviewerId))
    return added.length === 0 ? null : { recipients: [...current.recipients, ...added] }
  })
}

/** The one open named ask My PRs keeps per requester and pull request. */
export const ownAskCases: readonly ConformanceCase[] = [
  conformanceCase('a second own ask on the same pull request answers the first', async (repos) => {
    const first = own('a1')
    assert.deepStrictEqual(await repos.attention.createOrGetOwn(first), {
      request: first,
      created: true,
    })
    const second = await repos.attention.createOrGetOwn(own('a2', { createdAt: 2_000 }))
    assert.deepStrictEqual(second, { request: first, created: false })
    assert.strictEqual(await repos.attention.getById('a2'), null)
  }),

  conformanceCase('two own asks racing on one pull request write one ask', async (repos) => {
    const answers = await Promise.all([
      repos.attention.createOrGetOwn(own('a1')),
      repos.attention.createOrGetOwn(own('a2')),
    ])
    assert.strictEqual(answers.filter((answer) => answer.created).length, 1)
    const [first, second] = answers.map((answer) => answer.request.id)
    assert.strictEqual(first, second)
    assert.deepStrictEqual(await openIds(repos), [first])
  }),

  conformanceCase('two submits racing leave one ask naming everybody once', async (repos) => {
    await Promise.all([
      submit(repos, own('a1', { recipients: named('r1', 'r2') })),
      submit(repos, own('a2', { recipients: named('r2', 'r3') })),
    ])
    const [ask, ...others] = await repos.attention.list({ status: ['open'] })
    assert.deepStrictEqual(others, [])
    const people = ask?.recipients.map((entry) => entry.reviewerId).toSorted()
    assert.deepStrictEqual(people, ['r1', 'r2', 'r3'])
  }),

  conformanceCase('an own ask that closed leaves room for the next', async (repos) => {
    await repos.attention.createOrGetOwn(own('a1'))
    await repos.attention.change('a1', () => ({ status: 'cancelled' }))
    const next = await repos.attention.createOrGetOwn(own('a2', { createdAt: 2_000 }))
    assert.strictEqual(next.created, true)
    assert.deepStrictEqual(await openIds(repos), ['a2'])
  }),

  conformanceCase('another requester or pull request is another own ask', async (repos) => {
    await repos.attention.createOrGetOwn(own('a1'))
    const answers = await Promise.all([
      repos.attention.createOrGetOwn(own('a2', { requestedById: 'reviewer-2' })),
      repos.attention.createOrGetOwn(own('a3', { pullRequest: pullRequest({ number: 13 }) })),
      repos.attention.createOrGetOwn(
        own('a4', { pullRequest: pullRequest({ provider: 'gitlab' }) }),
      ),
    ])
    assert.deepStrictEqual(
      answers.map((answer) => answer.created),
      [true, true, true],
    )
  }),

  conformanceCase('an ask raised elsewhere holds no own key', async (repos) => {
    await repos.attention.create(own('a1'))
    const answer = await repos.attention.createOrGetOwn(own('a2', { createdAt: 2_000 }))
    assert.strictEqual(answer.created, true)
    assert.deepStrictEqual(await openIds(repos), ['a2', 'a1'])
  }),

  conformanceCase('an own ask over a taken id is a conflict, and writes nothing', async (repos) => {
    const elsewhere = own('a1', { requestedById: 'reviewer-2' })
    await repos.attention.create(elsewhere)
    await assert.rejects(repos.attention.createOrGetOwn(own('a1')), (error: unknown) => {
      assert.ok(error instanceof ConflictError)
      assert.match(error.message, /already taken/)
      return true
    })
    assert.deepStrictEqual(await repos.attention.getById('a1'), elsewhere)
  }),
]

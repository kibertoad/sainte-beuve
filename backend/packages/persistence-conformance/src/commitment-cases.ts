import assert from 'node:assert/strict'
import { ConflictError } from '@sainte-beuve/kernel'
import { type ConformanceCase, conformanceCase } from './case.js'
import { commitment, pullRequest } from './fixtures.js'

/** The promises people made against pull requests: one per person per pull request. */
export const commitmentCases: readonly ConformanceCase[] = [
  conformanceCase('a promise comes back with what it was made about', async (repos) => {
    const written = commitment('c1', { attentionRequestId: 'a1', requestedHandle: 'kibertoad' })
    assert.deepStrictEqual(await repos.commitments.createOrGet(written), {
      commitment: written,
      created: true,
    })
    assert.deepStrictEqual(await repos.commitments.getById('c1'), written)
  }),

  conformanceCase('a promise records the host request it holds, and drops it', async (repos) => {
    await repos.commitments.createOrGet(commitment('c1'))
    const claimed = await repos.commitments.setRequestedHandle('c1', 'kibertoad')
    assert.deepStrictEqual(claimed, commitment('c1', { requestedHandle: 'kibertoad' }))
    assert.deepStrictEqual(await repos.commitments.getById('c1'), claimed)
    await repos.commitments.setRequestedHandle('c1', null)
    assert.strictEqual((await repos.commitments.getById('c1'))?.requestedHandle, null)
  }),

  conformanceCase('a released promise takes no host request, and stays released', async (repos) => {
    await repos.commitments.createOrGet(commitment('c1'))
    await repos.commitments.delete('c1')
    assert.strictEqual(await repos.commitments.setRequestedHandle('c1', 'kibertoad'), null)
    assert.strictEqual(await repos.commitments.getById('c1'), null)
  }),

  conformanceCase("lists one person's promises newest first, ties on the id", async (repos) => {
    await repos.commitments.createOrGet(commitment('c1', { createdAt: 1_000 }))
    await repos.commitments.createOrGet(
      commitment('c2', { createdAt: 2_000, pullRequest: pullRequest({ number: 13 }) }),
    )
    await repos.commitments.createOrGet(commitment('c3', { reviewerId: 'r2' }))
    await repos.commitments.createOrGet(
      commitment('c4', { createdAt: 2_000, pullRequest: pullRequest({ number: 14 }) }),
    )
    const ids = (await repos.commitments.listByReviewer('reviewer-1')).map((row) => row.id)
    assert.deepStrictEqual(ids, ['c4', 'c2', 'c1'])
  }),

  conformanceCase('a second click on the same pull request finds the first', async (repos) => {
    await repos.commitments.createOrGet(commitment('c1'))
    const found = await repos.commitments.find('reviewer-1', pullRequest())
    assert.strictEqual(found?.id, 'c1')
    assert.strictEqual(await repos.commitments.find('r2', pullRequest()), null)
  }),

  conformanceCase('a second promise on the same pull request answers the first', async (repos) => {
    const first = commitment('c1', { requestedHandle: 'kibertoad' })
    await repos.commitments.createOrGet(first)
    const second = await repos.commitments.createOrGet(
      commitment('c2', { title: 'Another title', createdAt: 2_000 }),
    )
    assert.deepStrictEqual(second, { commitment: first, created: false })
    assert.strictEqual(await repos.commitments.getById('c2'), null)
  }),

  conformanceCase('two promises racing on one pull request write one row', async (repos) => {
    // A double click, or an inbox click and a Slack button landing together:
    // both miss any lookup, and the store's key decides which one wrote.
    const answers = await Promise.all([
      repos.commitments.createOrGet(commitment('c1')),
      repos.commitments.createOrGet(commitment('c2')),
    ])
    assert.strictEqual(answers.filter((answer) => answer.created).length, 1)
    const [first, second] = answers.map((answer) => answer.commitment.id)
    assert.strictEqual(first, second)
    const ids = (await repos.commitments.listByReviewer('reviewer-1')).map((row) => row.id)
    assert.deepStrictEqual(ids, [first])
  }),

  conformanceCase('the path of a pull request is one promise in any case', async (repos) => {
    await repos.commitments.createOrGet(commitment('c1'))
    const shouted = commitment('c2', {
      pullRequest: pullRequest({ owner: 'Platform', repo: 'API' }),
    })
    const answer = await repos.commitments.createOrGet(shouted)
    assert.strictEqual(answer.created, false)
    assert.strictEqual(answer.commitment.id, 'c1')
  }),

  conformanceCase('the same number on the other host is another promise', async (repos) => {
    // `platform/api#12` exists on GitHub and on GitLab, and they are two
    // different changes, so racing on both writes two rows.
    const answers = await Promise.all([
      repos.commitments.createOrGet(
        commitment('c1', { pullRequest: pullRequest({ provider: 'github' }) }),
      ),
      repos.commitments.createOrGet(
        commitment('c2', { pullRequest: pullRequest({ provider: 'gitlab' }) }),
      ),
    ])
    assert.deepStrictEqual(
      answers.map((answer) => [answer.commitment.id, answer.created]),
      [
        ['c1', true],
        ['c2', true],
      ],
    )
    const found = await repos.commitments.find('reviewer-1', pullRequest({ provider: 'gitlab' }))
    assert.strictEqual(found?.id, 'c2')
  }),

  conformanceCase('two people promising the same pull request are two promises', async (repos) => {
    const answers = await Promise.all([
      repos.commitments.createOrGet(commitment('c1', { reviewerId: 'r1' })),
      repos.commitments.createOrGet(commitment('c2', { reviewerId: 'r2' })),
    ])
    assert.deepStrictEqual(
      answers.map((answer) => answer.created),
      [true, true],
    )
    assert.strictEqual((await repos.commitments.find('r1', pullRequest()))?.id, 'c1')
    assert.strictEqual((await repos.commitments.find('r2', pullRequest()))?.id, 'c2')
  }),

  conformanceCase(
    'a promise whose id is taken is a conflict, and writes nothing',
    async (repos) => {
      await repos.commitments.createOrGet(commitment('c1'))
      const elsewhere = commitment('c1', { pullRequest: pullRequest({ number: 13 }) })
      await assert.rejects(repos.commitments.createOrGet(elsewhere), (error: unknown) => {
        assert.ok(error instanceof ConflictError)
        assert.match(error.message, /already taken/)
        return true
      })
      assert.deepStrictEqual(await repos.commitments.getById('c1'), commitment('c1'))
      assert.strictEqual(
        await repos.commitments.find('reviewer-1', pullRequest({ number: 13 })),
        null,
      )
    },
  ),

  conformanceCase('withdrawing a promise removes it, and frees its key', async (repos) => {
    await repos.commitments.createOrGet(commitment('c1'))
    await repos.commitments.delete('c1')
    assert.strictEqual(await repos.commitments.getById('c1'), null)
    assert.deepStrictEqual(await repos.commitments.listByReviewer('reviewer-1'), [])
    assert.strictEqual(await repos.commitments.find('reviewer-1', pullRequest()), null)
    const again = await repos.commitments.createOrGet(commitment('c2'))
    assert.deepStrictEqual(again, { commitment: commitment('c2'), created: true })
  }),
]

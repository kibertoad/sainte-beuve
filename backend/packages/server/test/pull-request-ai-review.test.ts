import type { AiReviewRun } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import { buildHarness, openReview, PR, post } from './helpers.js'

/**
 * Filing an AI review from a row that is not on the board yet: the workspace,
 * My PRs and My Reviews send the pull request rather than a review id.
 */
async function wired() {
  const catFactory = stubAiReview()
  const harness = await connectCatFactory(buildHarness(catFactoryWired({ aiReview: catFactory })))
  return { harness, catFactory }
}

const BODY = { pullRequest: PR, title: 'Add the thing', authorLogin: 'octocat' }

describe('filing an AI review by pull request', () => {
  it('tracks an untracked pull request on the board and files the review on it', async () => {
    const { harness, catFactory } = await wired()

    const res = await harness.app.fetch(post('/api/v1/ai-review', BODY))

    expect(res.status).toBe(202)
    const run = (await res.json()) as AiReviewRun
    expect(run.status).toBe('running')
    const review = await harness.container.repositories.reviews.getByPullRequest(PR)
    expect(review).toMatchObject({
      id: run.reviewId,
      title: 'Add the thing',
      authorLogin: 'octocat',
    })
    expect(catFactory.requested).toHaveLength(1)
  })

  it('files on the existing board row rather than opening a second one', async () => {
    const { harness } = await wired()
    const existing = await openReview(harness, { pullRequest: PR })

    const res = await harness.app.fetch(post('/api/v1/ai-review', BODY))

    expect(res.status).toBe(202)
    expect(((await res.json()) as AiReviewRun).reviewId).toBe(existing.id)
  })

  it('records an unknown author when the row that asked did not know it', async () => {
    const { harness } = await wired()

    const res = await harness.app.fetch(
      post('/api/v1/ai-review', { pullRequest: PR, title: 'Add the thing' }),
    )

    expect(res.status).toBe(202)
    const review = await harness.container.repositories.reviews.getByPullRequest(PR)
    expect(review?.authorLogin).toBe('unknown')
  })

  it('meets the same limit as the board button: one run in flight per review', async () => {
    const { harness, catFactory } = await wired()
    await harness.app.fetch(post('/api/v1/ai-review', BODY))

    const second = await harness.app.fetch(post('/api/v1/ai-review', BODY))

    expect(second.status).toBe(409)
    expect(catFactory.requested).toHaveLength(1)
  })

  it('answers 503 and tracks nothing when cat-factory is not configured', async () => {
    const harness = buildHarness()

    const res = await harness.app.fetch(post('/api/v1/ai-review', BODY))

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { message: /cat-factory/ } })
    expect(await harness.container.repositories.reviews.getByPullRequest(PR)).toBeNull()
  })

  it('refuses a body with no title', async () => {
    const { harness } = await wired()
    const res = await harness.app.fetch(post('/api/v1/ai-review', { pullRequest: PR, title: ' ' }))
    expect(res.status).toBe(400)
  })
})

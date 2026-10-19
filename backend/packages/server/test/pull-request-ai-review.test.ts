import type { AiReviewInFlightList, AiReviewRun } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import type { VcsGateway } from '@sainte-beuve/kernel'
import {
  buildHarness,
  environmentVcs,
  noMerging,
  openReview,
  PR,
  post,
  recordingVcs,
  type TestHarness,
} from './helpers.js'

/**
 * Filing an AI review from a row that is not on the board yet: the workspace,
 * My PRs and My Reviews send the pull request rather than a review id.
 */
async function wired(vcs: VcsGateway | null = null) {
  const catFactory = stubAiReview()
  const harness = await connectCatFactory(
    buildHarness({
      ...catFactoryWired({ aiReview: catFactory }),
      ...(vcs === null ? {} : { vcs: environmentVcs(vcs) }),
    }),
  )
  return { harness, catFactory }
}

/** A host that reports `authorLogin` as the pull request's author. */
function hostReportingAuthor(authorLogin: string): VcsGateway {
  return {
    ...recordingVcs(),
    pullRequestStatus: async () => ({
      state: 'open',
      url: PR.url,
      authorLogin,
      draft: false,
      approval: 'pending',
      mergeability: 'mergeable',
      headSha: 'abc123',
    }),
  }
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

  it('asks the host for the author when the row that asked did not know it', async () => {
    const { harness } = await wired(hostReportingAuthor('octocat'))

    const res = await harness.app.fetch(
      post('/api/v1/ai-review', { pullRequest: PR, title: 'Add the thing' }),
    )

    expect(res.status).toBe(202)
    const review = await harness.container.repositories.reviews.getByPullRequest(PR)
    expect(review?.authorLogin).toBe('octocat')
  })

  it('still files, with an unknown author, when the host cannot say who wrote it', async () => {
    const { harness, catFactory } = await wired({ ...recordingVcs(), ...noMerging() })

    const res = await harness.app.fetch(
      post('/api/v1/ai-review', { pullRequest: PR, title: 'Add the thing' }),
    )

    expect(res.status).toBe(202)
    const review = await harness.container.repositories.reviews.getByPullRequest(PR)
    expect(review?.authorLogin).toBe('unknown')
    expect(catFactory.requested).toHaveLength(1)
  })

  it('meets the same limit as the board button: one run in flight per review', async () => {
    const { harness, catFactory } = await wired()
    const first = (await (
      await harness.app.fetch(post('/api/v1/ai-review', BODY))
    ).json()) as AiReviewRun

    const second = await harness.app.fetch(post('/api/v1/ai-review', BODY))

    expect(second.status).toBe(409)
    // Named, so the row that asked can still take the person to the run in flight.
    expect(await second.json()).toMatchObject({ error: { details: { reviewId: first.reviewId } } })
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

describe('looking up the AI reviews in flight on a list', () => {
  const OTHER = { ...PR, number: 8, url: 'https://github.com/kibertoad/sainte-beuve/pull/8' }

  async function lookUp(harness: TestHarness, pullRequests: unknown[]) {
    const res = await harness.app.fetch(
      post('/api/v1/ai-review/in-flight/lookup', { pullRequests }),
    )
    expect(res.status).toBe(200)
    return ((await res.json()) as AiReviewInFlightList).runs
  }

  it('names the run in flight on a pull request, so the row offers its progress', async () => {
    const { harness } = await wired()
    const filed = (await (
      await harness.app.fetch(post('/api/v1/ai-review', BODY))
    ).json()) as AiReviewRun

    expect(await lookUp(harness, [PR, OTHER])).toStrictEqual([
      {
        pullRequest: PR,
        reviewId: filed.reviewId,
        runId: filed.id,
        status: 'running',
        requestedAt: filed.requestedAt,
      },
    ])
  })

  it('names nothing once the run has settled', async () => {
    const { harness } = await wired()
    const filed = (await (
      await harness.app.fetch(post('/api/v1/ai-review', BODY))
    ).json()) as AiReviewRun
    await harness.container.repositories.aiReviewRuns.update(filed.id, { status: 'completed' })

    expect(await lookUp(harness, [PR])).toStrictEqual([])
  })
})

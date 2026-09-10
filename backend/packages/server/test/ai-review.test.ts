import type { AiReviewRun } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  aiFinding,
  buildHarness,
  curation,
  get,
  openReview,
  post,
  type StubAiReview,
  stubAiReview,
  type TestHarness,
} from './helpers.js'

/**
 * The AI-review loop over `app.fetch`, which is where it is worth testing: one
 * pass covers the controller, the contract validation and the error envelope, and
 * the poll-on-read behaviour only exists at that boundary.
 */
describe('the AI review loop', () => {
  let harness: TestHarness
  let catFactory: StubAiReview

  beforeEach(() => {
    catFactory = stubAiReview()
    harness = buildHarness({ aiReview: catFactory })
  })

  /** File a review and read it back once, which is what learns the run id. */
  async function delegate(): Promise<AiReviewRun> {
    const review = await openReview(harness)
    const filed = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    expect(filed.status).toBe(202)
    return listRuns(review.id)
  }

  async function listRuns(reviewId: string): Promise<AiReviewRun> {
    const res = await harness.app.fetch(get(`/api/v1/reviews/${reviewId}/ai-review`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: AiReviewRun[] }
    expect(body.runs).toHaveLength(1)
    return body.runs[0] as AiReviewRun
  }

  it('files a review against cat-factory and tracks the run it accepted', async () => {
    const run = await delegate()
    expect(catFactory.requested).toHaveLength(1)
    expect(run.catFactoryTaskId).toBe('cf-task-1')
    expect(run.catFactoryUrl).toBe('https://cat-factory.example.com/tasks/cf-task-1')
    expect(run.status).toBe('running')
  })

  /**
   * The read is what learns the review parked. cat-factory calls nothing back, so
   * a list served from the store would show a review that has been waiting on a
   * person for an hour as still running.
   */
  it('polls on the read, so parked findings arrive without a clock', async () => {
    const review = await openReview(harness)
    await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))

    catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({
        findings: [aiFinding(), aiFinding({ findingId: 'f-2', severity: 'nit' })],
      }),
    }

    const run = await listRuns(review.id)
    expect(run.status).toBe('awaiting_selection')
    expect(run.catFactoryRunId).toBe('cf-run-1')
    expect(run.curation?.findings.map((f) => f.findingId)).toStrictEqual(['f-1', 'f-2'])
    // Parked is not finished: nothing has reached the pull request.
    expect(run.completedAt).toBeNull()
  })

  it('sends the curated selection to cat-factory and answers 202', async () => {
    const parked = await parkedRun()

    const res = await harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, {
        action: 'post',
        findingIds: ['f-1'],
      }),
    )

    expect(res.status).toBe(202)
    expect(catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'post', findingIds: ['f-1'] },
    ])
  })

  it('refuses a post with nothing selected, naming the action that closes a review', async () => {
    const parked = await parkedRun()
    const res = await harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'post', findingIds: [] }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { message: /`finish`/ } })
    expect(catFactory.resolved).toStrictEqual([])
  })

  it('lets a review be finished with nothing selected, which is the only way out', async () => {
    const parked = await parkedRun()
    const res = await harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'finish' }),
    )
    expect(res.status).toBe(202)
    expect(catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'finish', findingIds: [] },
    ])
  })

  it('refuses an action the contract does not describe', async () => {
    const parked = await parkedRun()
    const res = await harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'merge', findingIds: ['f-1'] }),
    )
    expect(res.status).toBe(400)
  })

  it('dismisses one finding by id, and leaves the review parked', async () => {
    const parked = await parkedRun()
    const res = await harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/findings/f-1/dismiss`, {}),
    )
    expect(res.status).toBe(200)
    expect(catFactory.dismissed).toStrictEqual([{ runId: 'cf-run-1', findingId: 'f-1' }])
    expect(((await res.json()) as AiReviewRun).status).toBe('awaiting_selection')
  })

  it('resumes a stalled review without being told which slices to redo', async () => {
    const parked = await parkedRun()
    const res = await harness.app.fetch(post(`/api/v1/ai-review/runs/${parked.id}/resume`, {}))
    expect(res.status).toBe(202)
    expect(catFactory.resumed).toStrictEqual(['cf-run-1'])
  })

  /**
   * The receipt is the whole reason the loop needs a poll after a post: a pass
   * that landed nothing re-parks at `awaiting_selection` with the selection
   * cleared, which is indistinguishable from a review nobody has curated.
   */
  it('carries the post receipt to the wire, so a failed pass is not read as success', async () => {
    const review = await openReview(harness)
    await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({
        findings: [aiFinding()],
        postAttempts: 1,
        postReport: {
          attempt: 1,
          attempted: 1,
          posted: 0,
          folded: 0,
          bodyPosted: false,
          bodyError: 'the branch was force-pushed',
          failures: [
            { findingId: 'f-1', path: 'src/poll.ts', line: 42, reason: 'line not in diff' },
          ],
        },
      }),
    }

    const run = await listRuns(review.id)
    expect(run.status).toBe('awaiting_selection')
    expect(run.curation?.postReport?.posted).toBe(0)
    expect(run.curation?.postReport?.failures).toStrictEqual([
      { findingId: 'f-1', path: 'src/poll.ts', line: 42, reason: 'line not in diff' },
    ])
  })

  it('settles the run once cat-factory reports the review done', async () => {
    const review = await openReview(harness)
    await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    catFactory.report = {
      status: 'completed',
      runId: 'cf-run-1',
      summary: 'Posted 3 comments.',
      failureReason: null,
      curation: null,
    }

    const run = await listRuns(review.id)
    expect(run.status).toBe('completed')
    expect(run.summary).toBe('Posted 3 comments.')
    expect(run.completedAt).not.toBeNull()

    // Settled means settled: a second read asks cat-factory nothing.
    const polls = catFactory.polls
    await listRuns(review.id)
    expect(catFactory.polls).toBe(polls)
  })

  /**
   * A board showing four reviews must not fail because the instance behind one of
   * them is down. The row stays as it was, and the next poll settles it.
   */
  it('leaves a run readable when cat-factory cannot be reached', async () => {
    const review = await openReview(harness)
    await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    catFactory.pollFails = true

    const run = await listRuns(review.id)
    expect(run.status).toBe('running')
    expect(run.failureReason).toBeNull()
  })

  it('answers 404 for a curation verb on a run whose cat-factory run has not appeared', async () => {
    const review = await openReview(harness)
    catFactory.report = { ...catFactory.report, runId: null }
    const filed = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    const run = (await filed.json()) as AiReviewRun

    const res = await harness.app.fetch(post(`/api/v1/ai-review/runs/${run.id}/resume`, {}))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { message: /no cat-factory run yet/ } })
  })

  it('answers 404 for a run this deployment never filed', async () => {
    const res = await harness.app.fetch(get('/api/v1/ai-review/runs/nope'))
    expect(res.status).toBe(404)
  })

  it('answers 503 naming cat-factory when a curation verb has nothing to reach', async () => {
    const parked = await parkedRun()
    const unconfigured = buildHarness({
      // The same store, so the run is there; only the gateway is gone, which is
      // what a deployment that dropped its cat-factory key looks like.
      repositories: harness.container.repositories,
      aiReview: null,
    })
    const res = await unconfigured.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'finish' }),
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable', message: /decide/ } })
  })

  /** A review parked on its findings, with the cat-factory run id learnt. */
  async function parkedRun(): Promise<AiReviewRun> {
    const run = await delegate()
    catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({ findings: [aiFinding()] }),
    }
    const reviewId = run.reviewId
    return listRuns(reviewId)
  }
})

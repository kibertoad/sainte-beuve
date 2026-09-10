import type { AiReviewRun, ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewReport } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiFinding, curation, type StubAiReview, stubAiReview } from './ai-review-doubles.js'
import { buildHarness, get, openReview, post, type TestHarness } from './helpers.js'

/**
 * The AI-review loop over `app.fetch`, which is where it is worth testing: one
 * pass covers the controller, the contract validation and the error envelope, and
 * the poll-on-read behaviour only exists at that boundary.
 */
interface Loop {
  harness: TestHarness
  catFactory: StubAiReview
}

/** A deployment wired to a cat-factory a case drives through the loop. */
function buildLoop(): Loop {
  const catFactory = stubAiReview()
  return { catFactory, harness: buildHarness({ aiReview: catFactory }) }
}

async function listRuns(loop: Loop, reviewId: string): Promise<AiReviewRun> {
  const res = await loop.harness.app.fetch(get(`/api/v1/reviews/${reviewId}/ai-review`))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { runs: AiReviewRun[] }
  expect(body.runs).toHaveLength(1)
  return body.runs[0] as AiReviewRun
}

/** A pull request handed to cat-factory, before a poll has advanced the run. */
async function filedReview(loop: Loop): Promise<ReviewRequest> {
  const review = await openReview(loop.harness)
  const filed = await loop.harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
  expect(filed.status).toBe(202)
  return review
}

/** File a review and read it back once, which is what learns the run id. */
async function delegate(loop: Loop): Promise<AiReviewRun> {
  const review = await filedReview(loop)
  return listRuns(loop, review.id)
}

/** A review parked on its findings, with the cat-factory run id learnt. */
async function parkedRun(loop: Loop): Promise<AiReviewRun> {
  const run = await delegate(loop)
  loop.catFactory.report = {
    status: 'awaiting_selection',
    runId: 'cf-run-1',
    summary: null,
    failureReason: null,
    curation: curation({ findings: [aiFinding()] }),
  }
  return listRuns(loop, run.reviewId)
}

describe('curating a delegated AI review', () => {
  let loop: Loop

  beforeEach(() => {
    loop = buildLoop()
  })

  it('files a review against cat-factory and tracks the run it accepted', async () => {
    const run = await delegate(loop)
    expect(loop.catFactory.requested).toHaveLength(1)
    expect(run.catFactoryTaskId).toBe('cf-task-1')
    expect(run.catFactoryUrl).toBe('https://cat-factory.example.com/tasks/cf-task-1')
    expect(run.status).toBe('running')
  })

  it('sends the curated selection to cat-factory and answers 202', async () => {
    const parked = await parkedRun(loop)

    const res = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, {
        action: 'post',
        findingIds: ['f-1'],
      }),
    )

    expect(res.status).toBe(202)
    expect(loop.catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'post', findingIds: ['f-1'] },
    ])
  })

  it('refuses a post with nothing selected, naming the action that closes a review', async () => {
    const parked = await parkedRun(loop)
    const res = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'post', findingIds: [] }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { message: /`finish`/ } })
    expect(loop.catFactory.resolved).toStrictEqual([])
  })

  it('lets a review be finished with nothing selected, which is the only way out', async () => {
    const parked = await parkedRun(loop)
    const res = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'finish' }),
    )
    expect(res.status).toBe(202)
    expect(loop.catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'finish', findingIds: [] },
    ])
  })

  it('refuses an action the contract does not describe', async () => {
    const parked = await parkedRun(loop)
    const res = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'merge', findingIds: ['f-1'] }),
    )
    expect(res.status).toBe(400)
  })

  /**
   * A dismissal is synchronous upstream and answers with the decision it left
   * behind, so the row is written from that answer. Re-polling would spend two
   * more cat-factory calls to be told the same thing.
   */
  it('dismisses one finding by id from the verb answer, without polling again', async () => {
    const parked = await parkedRun(loop)
    const polls = loop.catFactory.polls

    const res = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/findings/f-1/dismiss`, {}),
    )

    expect(res.status).toBe(200)
    expect(loop.catFactory.dismissed).toStrictEqual([{ runId: 'cf-run-1', findingId: 'f-1' }])
    const run = (await res.json()) as AiReviewRun
    expect(run.status).toBe('awaiting_selection')
    expect(run.curation?.findings).toStrictEqual([])
    expect(loop.catFactory.polls).toBe(polls)
  })

  it('resumes a stalled review without being told which slices to redo', async () => {
    const parked = await parkedRun(loop)
    const res = await loop.harness.app.fetch(post(`/api/v1/ai-review/runs/${parked.id}/resume`, {}))
    expect(res.status).toBe(202)
    expect(loop.catFactory.resumed).toStrictEqual(['cf-run-1'])
  })

  /**
   * 409 rather than 404, because the two mean opposite things to a caller: the
   * task was accepted and its run has not appeared yet, so the answer is to poll
   * again, where a 404 says the run is gone and to stop.
   */
  it('answers 409 for a curation verb on a run whose cat-factory run has not appeared', async () => {
    loop.catFactory.report = { ...loop.catFactory.report, runId: null }
    const review = await openReview(loop.harness)
    const filed = await loop.harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    const run = (await filed.json()) as AiReviewRun

    const res = await loop.harness.app.fetch(post(`/api/v1/ai-review/runs/${run.id}/resume`, {}))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { code: 'conflict', message: /no cat-factory run yet/ },
    })
  })

  it('answers 404 for a run this deployment never filed', async () => {
    const res = await loop.harness.app.fetch(get('/api/v1/ai-review/runs/nope'))
    expect(res.status).toBe(404)
  })

  it('answers 503 naming cat-factory when a curation verb has nothing to reach', async () => {
    const parked = await parkedRun(loop)
    const unconfigured = buildHarness({
      // The same store, so the run is there; only the gateway is gone, which is
      // what a deployment that dropped its cat-factory key looks like.
      repositories: loop.harness.container.repositories,
      aiReview: null,
    })
    const res = await unconfigured.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'finish' }),
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable', message: /decide/ } })
  })
})

describe('polling a delegated AI review', () => {
  let loop: Loop

  beforeEach(() => {
    loop = buildLoop()
  })

  /**
   * The read is what learns the review parked. cat-factory calls nothing back, so
   * a list served from the store would show a review that has been waiting on a
   * person for an hour as still running.
   */
  it('polls on the read, so parked findings arrive without a clock', async () => {
    const review = await filedReview(loop)
    loop.catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({
        findings: [aiFinding(), aiFinding({ findingId: 'f-2', severity: 'nit' })],
      }),
    }

    const run = await listRuns(loop, review.id)
    expect(run.status).toBe('awaiting_selection')
    expect(run.catFactoryRunId).toBe('cf-run-1')
    expect(run.curation?.findings.map((f) => f.findingId)).toStrictEqual(['f-1', 'f-2'])
    // Parked is not finished: nothing has reached the pull request.
    expect(run.completedAt).toBeNull()
  })

  /**
   * The receipt is the whole reason the loop needs a poll after a post: a pass
   * that landed nothing re-parks at `awaiting_selection` with the selection
   * cleared, which is indistinguishable from a review nobody has curated.
   */
  it('carries the post receipt to the wire, so a failed pass is not read as success', async () => {
    const review = await filedReview(loop)
    loop.catFactory.report = {
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

    const run = await listRuns(loop, review.id)
    expect(run.status).toBe('awaiting_selection')
    expect(run.curation?.postReport?.posted).toBe(0)
    expect(run.curation?.postReport?.failures).toStrictEqual([
      { findingId: 'f-1', path: 'src/poll.ts', line: 42, reason: 'line not in diff' },
    ])
  })

  it('settles the run once cat-factory reports the review done', async () => {
    const review = await filedReview(loop)
    loop.catFactory.report = {
      status: 'completed',
      runId: 'cf-run-1',
      summary: 'Posted 3 comments.',
      failureReason: null,
      curation: null,
    }

    const run = await listRuns(loop, review.id)
    expect(run.status).toBe('completed')
    expect(run.summary).toBe('Posted 3 comments.')
    expect(run.completedAt).not.toBeNull()

    // Settled means settled: a second read asks cat-factory nothing.
    const polls = loop.catFactory.polls
    await listRuns(loop, review.id)
    expect(loop.catFactory.polls).toBe(polls)
  })

  /**
   * cat-factory drops the decision from its list when the loop settles, so the
   * poll that sees a review finish is the poll that sees no decision. Writing
   * that through would destroy the receipt at the moment somebody wants to read
   * what landed, and nothing could bring it back.
   */
  it('keeps the post receipt when the run settles and the decision is gone', async () => {
    const review = await filedReview(loop)
    loop.catFactory.report = {
      status: 'running',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({
        status: 'posting',
        findings: [aiFinding()],
        postedFindingIds: ['f-1'],
        postAttempts: 1,
        postReport: {
          attempt: 1,
          attempted: 1,
          posted: 1,
          folded: 0,
          bodyPosted: true,
          bodyError: null,
          failures: [],
        },
      }),
    }
    await listRuns(loop, review.id)

    loop.catFactory.report = {
      status: 'completed',
      runId: 'cf-run-1',
      summary: 'Posted 1 comment.',
      failureReason: null,
      curation: null,
    }
    const run = await listRuns(loop, review.id)

    expect(run.status).toBe('completed')
    expect(run.curation?.postReport?.posted).toBe(1)
    expect(run.curation?.postedFindingIds).toStrictEqual(['f-1'])
    expect(run.curation?.findings.map((finding) => finding.findingId)).toStrictEqual(['f-1'])
  })

  /**
   * Two reads of one review can have polls in flight at once, and the slower
   * answer is the older one: a manual Refresh landing on top of the interval is
   * enough. The older answer must not walk a settled run back into flight and
   * take its verdict with it.
   */
  it('does not let a slower poll walk a settled run back into flight', async () => {
    const review = await filedReview(loop)
    const parked: AiReviewReport = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({ findings: [aiFinding()] }),
    }
    loop.catFactory.report = parked

    // The parked answer is already out when a second read settles the run, so it
    // lands second and describes a moment that has passed.
    const poll = loop.catFactory.getStatus
    loop.catFactory.getStatus = async () => {
      loop.catFactory.getStatus = poll
      loop.catFactory.report = {
        status: 'completed',
        runId: 'cf-run-1',
        summary: 'Posted 3 comments.',
        failureReason: null,
        curation: null,
      }
      await listRuns(loop, review.id)
      loop.harness.clock.advance(60_000)
      return parked
    }

    const settledAt = loop.harness.clock.now()
    const run = await listRuns(loop, review.id)
    expect(run.status).toBe('completed')
    expect(run.summary).toBe('Posted 3 comments.')
    // Stamped once, rather than re-stamped from a later reading of the clock.
    expect(run.completedAt).toBe(settledAt)
  })

  /**
   * A board showing four reviews must not fail because the instance behind one of
   * them is down. The row keeps its status, and the next poll settles it. What it
   * does not keep is silence: a revoked key refuses every poll for ever, and a
   * row that goes on saying `running` with nothing beside it reads as a reviewer
   * that is merely slow.
   */
  it('leaves a run readable when cat-factory cannot be reached, and says so on the row', async () => {
    const review = await filedReview(loop)
    loop.catFactory.pollFails = true

    const run = await listRuns(loop, review.id)
    expect(run.status).toBe('running')
    expect(run.failureReason).toMatch(/could not be read from cat-factory/)

    // And it clears itself once a poll gets through.
    loop.catFactory.pollFails = false
    expect((await listRuns(loop, review.id)).failureReason).toBeNull()
  })

  /**
   * These GETs are not reads: answering one polls cat-factory with the
   * deployment's key and writes what it learns onto the run. The wildcard every
   * runtime defaults to covers reads, so it must not cover these, or any page an
   * operator visits could lift a private pull request's findings and loop the
   * request to burn the key.
   */
  it('keeps the wildcard off the AI-review reads, which poll and write', async () => {
    const review = await openReview(loop.harness)
    const header = 'access-control-allow-origin'
    const read = (path: string, origin: string) =>
      loop.harness.app.fetch(new Request(`http://localhost${path}`, { headers: { origin } }))

    for (const path of [`/api/v1/reviews/${review.id}/ai-review`, '/api/v1/ai-review/runs/r-1']) {
      expect((await read(path, 'https://evil.example.com')).headers.get(header)).toBeNull()
      // Loopback still passes: that is the local SPA, already code running on the
      // operator's own machine.
      expect((await read(path, 'http://localhost:3000')).headers.get(header)).toBe(
        'http://localhost:3000',
      )
    }

    // The board's own read is unaffected, because it is a read.
    const board = await read('/api/v1/reviews', 'https://evil.example.com')
    expect(board.headers.get(header)).toBe('*')
  })
})

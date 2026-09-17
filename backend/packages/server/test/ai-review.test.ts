import type { AiReviewRun, ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewReport } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiFinding, curation, type StubAiReview, stubAiReview } from './ai-review-doubles.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { buildHarness, get, openReview, PR, post, type TestHarness } from './helpers.js'

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
async function filedReview(
  loop: Loop,
  overrides: Partial<Parameters<typeof openReview>[1]> = {},
): Promise<ReviewRequest> {
  const review = await openReview(loop.harness, overrides)
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

/**
 * The clock's half of the loop, which the read cannot supply: a review that parks
 * while every board in the team is closed has to become a fact the deployment
 * holds, rather than one waiting for somebody to already suspect it and look.
 */
describe('polling a delegated AI review on the reminder tick', () => {
  let loop: Loop

  beforeEach(() => {
    loop = buildLoop()
  })

  it('polls what is in flight, with no read of the row', async () => {
    const review = await filedReview(loop)
    loop.catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({ findings: [aiFinding()] }),
    }

    expect(await runReminderTick(loop.harness.container)).toMatchObject({ aiReviewsPolled: 1 })

    // Straight out of the store, without the read that would have polled it.
    const stored = await loop.harness.container.repositories.aiReviewRuns.listByReview(review.id)
    expect(stored[0]?.status).toBe('awaiting_selection')
    expect(stored[0]?.curation?.findings).toHaveLength(1)
  })

  it('stops polling a run once it has settled', async () => {
    await filedReview(loop)
    loop.catFactory.report = {
      status: 'completed',
      runId: 'cf-run-1',
      summary: 'Posted 2 comments.',
      failureReason: null,
      curation: null,
    }
    expect(await runReminderTick(loop.harness.container)).toMatchObject({ aiReviewsPolled: 1 })

    const polls = loop.catFactory.polls
    expect(await runReminderTick(loop.harness.container)).toMatchObject({ aiReviewsPolled: 0 })
    expect(loop.catFactory.polls).toBe(polls)
  })

  /**
   * A cat-factory that cannot be reached is a bad minute, not a reason to stop
   * ticking: the nudges in the same pass have already gone out, and the reason
   * belongs on the row where the board shows it.
   */
  it('records an unreachable cat-factory on the row without failing the tick', async () => {
    const review = await filedReview(loop)
    loop.catFactory.pollFails = true

    expect(await runReminderTick(loop.harness.container)).toMatchObject({ aiReviewsPolled: 1 })

    const stored = await loop.harness.container.repositories.aiReviewRuns.listByReview(review.id)
    expect(stored[0]?.status).toBe('running')
    expect(stored[0]?.failureReason).toMatch(/could not be read from cat-factory/)
  })

  /**
   * The property the batch cap rests on, and the one a cap alone does not give.
   *
   * `awaiting_selection` is a state no poll can end — only a person curating can
   * — so a run that parks stays in flight indefinitely. Read oldest-request-first,
   * a batch's worth of parked runs would hold the whole cap for ever and the
   * clock would never reach a newer review at all, which is precisely the silence
   * this pass exists to end.
   */
  it('rotates past a parked review instead of polling it every tick', async () => {
    const parked = await filedReview(loop)
    loop.catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({ findings: [aiFinding()] }),
    }
    // Filed second, so it is the NEWER request and loses every oldest-first race.
    await filedReview(loop, {
      pullRequest: { ...PR, number: 8, url: 'https://github.com/kibertoad/sainte-beuve/pull/8' },
    })

    // One at a time, which is the cap standing in for a tenancy holding more
    // parked reviews than a tick may poll.
    await runReminderTick(loop.harness.container, 1)
    await runReminderTick(loop.harness.container, 1)
    await runReminderTick(loop.harness.container, 1)

    // The parked run is polled, then the newer one, then the parked one again:
    // a rotation, not a queue with a permanent head.
    expect(loop.catFactory.polled).toStrictEqual(['cf-task-1', 'cf-task-2', 'cf-task-1'])
    expect(parked.id).toBeTruthy()
  })

  /**
   * A row that is in flight with nothing to poll, which is what a process dying
   * mid-request leaves behind: the run is written before the call goes out.
   * Nothing can ever settle it from cat-factory's side, so the clock settles it.
   */
  it('writes off a run cat-factory never acknowledged, once it cannot still be', async () => {
    const { aiReviewRuns } = loop.harness.container.repositories
    const review = await openReview(loop.harness)
    await aiReviewRuns.create({
      id: 'run-orphan',
      reviewId: review.id,
      status: 'requested',
      catFactoryTaskId: null,
      catFactoryRunId: null,
      catFactoryUrl: null,
      summary: null,
      failureReason: null,
      curation: null,
      requestedAt: loop.harness.clock.now(),
      lastPolledAt: null,
      completedAt: null,
    })

    // A request that is merely in flight is left alone: nothing about the row
    // says yet whether the call is slow or the process is gone.
    await runReminderTick(loop.harness.container)
    expect((await aiReviewRuns.getById('run-orphan'))?.status).toBe('requested')
    expect(loop.catFactory.polls).toBe(0)

    loop.harness.clock.advance(10 * 60 * 1000)
    await runReminderTick(loop.harness.container)

    const settled = await aiReviewRuns.getById('run-orphan')
    expect(settled?.status).toBe('failed')
    expect(settled?.failureReason).toMatch(/never acknowledged/)
    expect(settled?.completedAt).toBe(loop.harness.clock.now())
    // Settled, so it is out of the in-flight read for good rather than holding a
    // place in every batch the clock ever reads.
    expect(await aiReviewRuns.listInFlight(10)).toStrictEqual([])
  })

  /**
   * A refusal that comes back after the run has settled is a refusal about a
   * moment that has passed. Stamped anyway it would never be cleared, because a
   * settled run is never polled again: the board would say for ever that a
   * finished review could not be read.
   */
  it('does not stamp a refused poll on a run that settled while it was in flight', async () => {
    const review = await filedReview(loop)
    const { aiReviewRuns } = loop.harness.container.repositories
    const [run] = await aiReviewRuns.listByReview(review.id)
    loop.catFactory.pollFails = true
    loop.catFactory.onPoll = async () => {
      // What a read, or a curation verb, does underneath a sweep that has
      // already snapshotted its batch.
      await aiReviewRuns.update(run?.id ?? '', { status: 'completed', completedAt: 1 })
    }

    await runReminderTick(loop.harness.container)

    const stored = await aiReviewRuns.getById(run?.id ?? '')
    expect(stored?.status).toBe('completed')
    expect(stored?.failureReason).toBeNull()
  })

  /**
   * The same race, with a report rather than a refusal: the poll answers with the
   * parked review as it was BEFORE a post landed. Written through, it would erase
   * the receipt for comments that really did reach the pull request.
   */
  it('keeps a post receipt a slower poll reports its way past', async () => {
    const parked = await parkedRun(loop)
    const { aiReviewRuns } = loop.harness.container.repositories
    const posted = curation({
      findings: [aiFinding()],
      postAttempts: 1,
      postedFindingIds: ['f-1'],
      postReport: {
        attempt: 1,
        attempted: 1,
        posted: 1,
        folded: 0,
        bodyPosted: true,
        bodyError: null,
        failures: [],
      },
    })
    await aiReviewRuns.update(parked.id, { curation: posted })
    // What was true before the post: the same review, one pass earlier.
    loop.catFactory.report = {
      status: 'awaiting_selection',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: curation({ findings: [aiFinding()], postAttempts: 0 }),
    }

    await runReminderTick(loop.harness.container)

    const stored = await aiReviewRuns.getById(parked.id)
    expect(stored?.curation?.postAttempts).toBe(1)
    expect(stored?.curation?.postReport?.posted).toBe(1)
  })
})

import type { AiReviewFinding, AiReviewRun } from '@sainte-beuve/contracts'
import { AI_REVIEW_CHALLENGE_LIMIT } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiFinding, curation, type StubAiReview, stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import { buildHarness, get, openReview, post, type TestHarness } from './helpers.js'

/**
 * Challenging a finding of a parked AI review, over `app.fetch`: the verb, the
 * budget in front of it, and a retracted finding kept off the pull request.
 */
interface Loop {
  harness: TestHarness
  catFactory: StubAiReview
}

async function buildLoop(): Promise<Loop> {
  const catFactory = stubAiReview()
  const harness = await connectCatFactory(buildHarness(catFactoryWired({ aiReview: catFactory })))
  return { catFactory, harness }
}

async function readRun(loop: Loop, runId: string): Promise<AiReviewRun> {
  const res = await loop.harness.app.fetch(get(`/api/v1/ai-review/runs/${runId}`))
  expect(res.status).toBe(200)
  return (await res.json()) as AiReviewRun
}

/** A review parked on `findings`, with the cat-factory run id learnt. */
async function parkedOn(loop: Loop, findings: AiReviewFinding[]): Promise<AiReviewRun> {
  const review = await openReview(loop.harness)
  const filed = await loop.harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
  expect(filed.status).toBe(202)
  const { id } = (await filed.json()) as AiReviewRun
  loop.catFactory.report = {
    status: 'awaiting_selection',
    runId: 'cf-run-1',
    summary: null,
    failureReason: null,
    curation: curation({ findings }),
  }
  return readRun(loop, id)
}

function challenge(runId: string, findingId: string, question: string | null = null) {
  return post(`/api/v1/ai-review/runs/${runId}/findings/${findingId}/challenge`, { question })
}

/** What cat-factory reports once the investigator has answered on `findingId`. */
function verdictOn(loop: Loop, findingId: string, status: 'upheld' | 'retracted'): void {
  const state = loop.catFactory.report.curation
  if (state === null) throw new Error('no curation to give a verdict on')
  loop.catFactory.report = {
    ...loop.catFactory.report,
    status: 'awaiting_selection',
    curation: {
      ...state,
      status: 'awaiting_selection',
      findings: state.findings.map((finding) =>
        finding.findingId === findingId
          ? { ...finding, challenge: { status, question: null, justification: 'Read the caller.' } }
          : finding,
      ),
    },
  }
}

/** What cat-factory reports once `findingId` is dismissed: the finding is gone. */
function dismissUpstream(loop: Loop, findingId: string): void {
  const state = loop.catFactory.report.curation
  if (state === null) throw new Error('no curation to dismiss from')
  loop.catFactory.report = {
    ...loop.catFactory.report,
    curation: {
      ...state,
      findings: state.findings.filter((finding) => finding.findingId !== findingId),
    },
  }
}

describe('challenging a finding of a parked AI review', () => {
  let loop: Loop

  beforeEach(async () => {
    loop = await buildLoop()
  })

  it('sends the challenge with its concern and answers with the run back in flight', async () => {
    const parked = await parkedOn(loop, [aiFinding()])

    const res = await loop.harness.app.fetch(challenge(parked.id, 'f-1', 'Is it reachable?'))

    expect(res.status).toBe(202)
    expect(loop.catFactory.challenged).toStrictEqual([
      { runId: 'cf-run-1', findingId: 'f-1', question: 'Is it reachable?' },
    ])
    const run = (await res.json()) as AiReviewRun
    // Waiting on the investigator rather than on a person, so not parked: the
    // reminder ladder must not chase anybody about it meanwhile.
    expect(run.status).toBe('running')
    expect(run.parkedAt).toBeNull()
    expect(run.curation?.status).toBe('challenging')
    expect(run.curation?.findings[0]?.challenge?.status).toBe('investigating')
  })

  it('reads the verdict back and parks the review on it again', async () => {
    const parked = await parkedOn(loop, [aiFinding()])
    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))
    verdictOn(loop, 'f-1', 'upheld')

    const run = await readRun(loop, parked.id)

    expect(run.status).toBe('awaiting_selection')
    expect(run.curation?.findings[0]?.challenge).toStrictEqual({
      status: 'upheld',
      question: null,
      justification: 'Read the caller.',
    })
  })

  it('refuses a second challenge of a finding that has its verdict, without asking cat-factory', async () => {
    const parked = await parkedOn(loop, [aiFinding()])
    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))
    verdictOn(loop, 'f-1', 'upheld')

    const res = await loop.harness.app.fetch(challenge(parked.id, 'f-1'))

    expect(res.status).toBe(409)
    expect(loop.catFactory.challenged).toHaveLength(1)
  })

  it('refuses a challenge while another is being investigated', async () => {
    const parked = await parkedOn(loop, [aiFinding(), aiFinding({ findingId: 'f-2' })])
    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))

    const res = await loop.harness.app.fetch(challenge(parked.id, 'f-2'))

    expect(res.status).toBe(409)
    expect(loop.catFactory.challenged).toHaveLength(1)
  })

  it('stops once as many findings have been challenged as the review may have', async () => {
    const answered = Array.from({ length: AI_REVIEW_CHALLENGE_LIMIT }, (_, i) =>
      aiFinding({
        findingId: `answered-${i}`,
        challenge: { status: 'upheld', question: null, justification: 'Held.' },
      }),
    )
    const parked = await parkedOn(loop, [...answered, aiFinding({ findingId: 'next' })])

    const res = await loop.harness.app.fetch(challenge(parked.id, 'next'))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'conflict',
        message: new RegExp(`${AI_REVIEW_CHALLENGE_LIMIT} findings of this review`),
      },
    })
    expect(loop.catFactory.challenged).toStrictEqual([])
  })

  it('keeps counting a challenged finding after it is dismissed', async () => {
    const findings = Array.from({ length: AI_REVIEW_CHALLENGE_LIMIT + 1 }, (_, i) =>
      aiFinding({ findingId: `f-${i}` }),
    )
    const parked = await parkedOn(loop, findings)
    for (let i = 0; i < AI_REVIEW_CHALLENGE_LIMIT; i += 1) {
      const res = await loop.harness.app.fetch(challenge(parked.id, `f-${i}`))
      expect(res.status).toBe(202)
      verdictOn(loop, `f-${i}`, 'upheld')
      await readRun(loop, parked.id)
      await loop.harness.app.fetch(
        post(`/api/v1/ai-review/runs/${parked.id}/findings/f-${i}/dismiss`, {}),
      )
      dismissUpstream(loop, `f-${i}`)
    }

    const res = await loop.harness.app.fetch(challenge(parked.id, `f-${AI_REVIEW_CHALLENGE_LIMIT}`))

    expect(res.status).toBe(409)
    expect(loop.catFactory.challenged).toHaveLength(AI_REVIEW_CHALLENGE_LIMIT)
  })

  it('names the workspace the run was filed in', async () => {
    loop.catFactory.filedIn = 'ws-a'
    const parked = await parkedOn(loop, [aiFinding()])
    loop.catFactory.workspaces.length = 0

    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))

    expect(new Set(loop.catFactory.workspaces)).toStrictEqual(new Set(['ws-a']))
  })

  it('parks the review anew when a verdict lands between two polls that both read it parked', async () => {
    const parked = await parkedOn(loop, [aiFinding()])
    loop.harness.clock.advance(60_000)
    verdictOn(loop, 'f-1', 'upheld')

    const run = await readRun(loop, parked.id)

    expect(run.parkedAt).toBe(loop.harness.clock.now())
    expect(run.parkedAt).not.toBe(parked.parkedAt)
  })

  it('answers 404 for a finding the review does not carry', async () => {
    const parked = await parkedOn(loop, [aiFinding()])
    const res = await loop.harness.app.fetch(challenge(parked.id, 'f-9'))
    expect(res.status).toBe(404)
  })

  it('refuses to post a retracted finding the stored row has not seen retracted yet', async () => {
    const parked = await parkedOn(loop, [aiFinding(), aiFinding({ findingId: 'f-2' })])
    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))
    verdictOn(loop, 'f-1', 'retracted')

    const refused = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, {
        action: 'post',
        findingIds: ['f-1', 'f-2'],
      }),
    )

    expect(refused.status).toBe(400)
    expect(loop.catFactory.resolved).toStrictEqual([])
  })

  it('refuses to post a finding a challenge retracted', async () => {
    const parked = await parkedOn(loop, [aiFinding(), aiFinding({ findingId: 'f-2' })])
    await loop.harness.app.fetch(challenge(parked.id, 'f-1'))
    verdictOn(loop, 'f-1', 'retracted')
    await readRun(loop, parked.id)

    const refused = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, {
        action: 'post',
        findingIds: ['f-1', 'f-2'],
      }),
    )
    const accepted = await loop.harness.app.fetch(
      post(`/api/v1/ai-review/runs/${parked.id}/resolve`, { action: 'post', findingIds: ['f-2'] }),
    )

    expect(refused.status).toBe(400)
    expect(accepted.status).toBe(202)
    expect(loop.catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'post', findingIds: ['f-2'], fixFindingIds: [] },
    ])
  })
})

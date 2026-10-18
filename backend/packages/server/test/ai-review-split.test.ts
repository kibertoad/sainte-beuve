import type { AiReviewRun } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiFinding, curation, type StubAiReview, stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import { buildHarness, get, openReview, post, type TestHarness } from './helpers.js'

/**
 * Settling a parked AI review with comments on some findings and the fixer on
 * others, over `app.fetch`.
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

/** A review parked on two findings, on an instance that does or does not queue fixes. */
async function parked(loop: Loop, combinesPostAndFix: boolean): Promise<AiReviewRun> {
  const review = await openReview(loop.harness)
  const filed = await loop.harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
  const { id } = (await filed.json()) as AiReviewRun
  loop.catFactory.report = {
    status: 'awaiting_selection',
    runId: 'cf-run-1',
    summary: null,
    failureReason: null,
    curation: curation({
      findings: [aiFinding({ findingId: 'f-1' }), aiFinding({ findingId: 'f-2' })],
      combinesPostAndFix,
    }),
  }
  const res = await loop.harness.app.fetch(get(`/api/v1/ai-review/runs/${id}`))
  return (await res.json()) as AiReviewRun
}

function resolve(runId: string, body: Record<string, unknown>) {
  return post(`/api/v1/ai-review/runs/${runId}/resolve`, body)
}

describe('posting some findings and fixing others in one resolution', () => {
  let loop: Loop
  beforeEach(async () => {
    loop = await buildLoop()
  })

  it('sends the comments and the queued fixes together', async () => {
    const run = await parked(loop, true)

    const res = await loop.harness.app.fetch(
      resolve(run.id, { action: 'post', findingIds: ['f-1'], fixFindingIds: ['f-2'] }),
    )

    expect(res.status).toBe(202)
    expect(loop.catFactory.resolved).toStrictEqual([
      { runId: 'cf-run-1', action: 'post', findingIds: ['f-1'], fixFindingIds: ['f-2'] },
    ])
  })

  it('refuses a split the instance would drop, and sends nothing', async () => {
    const run = await parked(loop, false)

    const res = await loop.harness.app.fetch(
      resolve(run.id, { action: 'post', findingIds: ['f-1'], fixFindingIds: ['f-2'] }),
    )

    expect(res.status).toBe(409)
    expect(loop.catFactory.resolved).toStrictEqual([])
  })

  it('refuses fixes queued behind anything but a post', async () => {
    const run = await parked(loop, true)

    const res = await loop.harness.app.fetch(
      resolve(run.id, { action: 'fix', findingIds: ['f-1'], fixFindingIds: ['f-2'] }),
    )

    expect(res.status).toBe(400)
    expect(loop.catFactory.resolved).toStrictEqual([])
  })

  it('refuses to fix a finding a challenge retracted', async () => {
    const run = await parked(loop, true)
    const state = loop.catFactory.report.curation!
    loop.catFactory.report = {
      ...loop.catFactory.report,
      curation: {
        ...state,
        findings: state.findings.map((finding) =>
          finding.findingId === 'f-2'
            ? {
                ...finding,
                challenge: { status: 'retracted', question: null, justification: 'no' },
              }
            : finding,
        ),
      },
    }

    const res = await loop.harness.app.fetch(
      resolve(run.id, { action: 'post', findingIds: ['f-1'], fixFindingIds: ['f-2'] }),
    )

    expect(res.status).toBe(400)
    expect(loop.catFactory.resolved).toStrictEqual([])
  })
})

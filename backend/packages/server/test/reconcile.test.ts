import type { AiReviewRun } from '@sainte-beuve/contracts'
import type { AiReviewReport } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { curationFor } from '../src/modules/reviews/reconcile.js'
import { aiFinding, curation } from './ai-review-doubles.js'

/**
 * Which of two pictures of a parked review is the newer one.
 *
 * Directly rather than through `app.fetch`, because it is a decision over data:
 * the cases that matter are the ones a route cannot easily stage, and staging
 * them through the loop would prove the staging rather than the rule.
 */

/** A run holding one curation, with nothing else a case reads. */
function holding(held: AiReviewRun['curation']): AiReviewRun {
  return {
    id: 'run-1',
    reviewId: 'review-1',
    status: 'awaiting_selection',
    catFactoryTaskId: 'cf-task-1',
    catFactoryRunId: 'cf-run-1',
    catFactoryUrl: null,
    catFactoryWorkspaceId: null,
    summary: null,
    failureReason: null,
    curation: held,
    challengedFindingIds: [],
    progress: null,
    requestedAt: 1_000,
    lastPolledAt: null,
    parkedAt: null,
    completedAt: null,
  }
}

function reporting(reported: AiReviewRun['curation']): AiReviewReport {
  return {
    status: 'awaiting_selection',
    runId: 'cf-run-1',
    summary: null,
    failureReason: null,
    curation: reported,
  }
}

describe('the curation a poll writes', () => {
  it('keeps what the row holds when the report carries none', () => {
    // A settled run drops its decision from cat-factory's list, so the poll that
    // sees a review finish is the poll that sees no decision.
    const held = curation({ findings: [aiFinding()] })
    expect(curationFor(reporting(null), holding(held))).toStrictEqual(held)
  })

  it('takes the report when the row holds none', () => {
    const reported = curation({ findings: [aiFinding()] })
    expect(curationFor(reporting(reported), holding(null))).toStrictEqual(reported)
  })

  it('keeps the row when the report is from before the last post', () => {
    const held = curation({ postAttempts: 2 })
    const older = curation({ postAttempts: 1 })
    expect(curationFor(reporting(older), holding(held))).toStrictEqual(held)
  })

  it('takes the report when it is from after the last post', () => {
    const newer = curation({ postAttempts: 3 })
    expect(curationFor(reporting(newer), holding(curation({ postAttempts: 2 })))).toStrictEqual(
      newer,
    )
  })

  it('falls back to the heartbeat when the post count has not moved', () => {
    const held = curation({ postAttempts: 1, lastActivityAt: 5_000 })
    const older = curation({ postAttempts: 1, lastActivityAt: 4_000 })
    const newer = curation({ postAttempts: 1, lastActivityAt: 6_000 })
    expect(curationFor(reporting(older), holding(held))).toStrictEqual(held)
    expect(curationFor(reporting(newer), holding(held))).toStrictEqual(newer)
  })

  it('treats an unstamped heartbeat as unknown rather than as stale', () => {
    // An instance that does not stamp one says nothing about which picture is
    // newer, so the report wins — which is the answer this gave before it
    // compared anything at all.
    const held = curation({ postAttempts: 1, lastActivityAt: 5_000 })
    const unstamped = curation({ postAttempts: 1, lastActivityAt: null })
    expect(curationFor(reporting(unstamped), holding(held))).toStrictEqual(unstamped)
    expect(
      curationFor(reporting(held), holding(curation({ postAttempts: 1, lastActivityAt: null }))),
    ).toStrictEqual(held)
  })

  it('keeps the row when the report predates a challenge it holds', () => {
    // Filing a challenge restarts cat-factory's step and clears its heartbeat,
    // so only the finding itself says which picture is older.
    const investigating = aiFinding({
      challenge: { status: 'investigating', question: null, justification: null },
    })
    const held = curation({
      status: 'challenging',
      findings: [investigating],
      lastActivityAt: null,
    })
    const older = curation({ findings: [aiFinding()], lastActivityAt: 5_000 })
    expect(curationFor(reporting(older), holding(held))).toStrictEqual(held)
  })

  it('takes a report that moves a challenge on, or no longer carries the finding', () => {
    const investigating = aiFinding({
      challenge: { status: 'investigating', question: null, justification: null },
    })
    const held = curation({ status: 'challenging', findings: [investigating] })
    const verdict = curation({
      findings: [
        aiFinding({ challenge: { status: 'retracted', question: null, justification: 'No.' } }),
      ],
    })
    const dismissed = curation({ findings: [] })
    expect(curationFor(reporting(verdict), holding(held))).toStrictEqual(verdict)
    expect(curationFor(reporting(dismissed), holding(held))).toStrictEqual(dismissed)
  })
})

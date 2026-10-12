import type {
  AiReviewChallengeStatus,
  AiReviewCuration,
  AiReviewFinding,
} from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  AI_REVIEW_CHALLENGE_LIMIT,
  decideChallengeAdmission,
  retractedFindingIds,
} from './aiChallenge.js'

function finding(
  findingId: string,
  verdict: AiReviewChallengeStatus | null = null,
): AiReviewFinding {
  return {
    findingId,
    title: 'Unbounded retry',
    detail: 'The loop never gives up.',
    path: 'src/poll.ts',
    line: 42,
    side: 'RIGHT',
    severity: 'high',
    category: 'correctness',
    suggestedFix: null,
    challenge:
      verdict === null ? null : { status: verdict, question: null, justification: 'Because.' },
  }
}

function parked(
  findings: AiReviewFinding[],
  status: AiReviewCuration['status'] = 'awaiting_selection',
): AiReviewCuration {
  return {
    status,
    findings,
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    sliceCount: 1,
    reportedSliceCount: 1,
    lastActivityAt: null,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
  }
}

describe('decideChallengeAdmission', () => {
  it('admits a challenge of an unchallenged finding on a parked review', () => {
    expect(decideChallengeAdmission(parked([finding('f-1')]), 'f-1')).toStrictEqual({
      admitted: true,
    })
  })

  it('refuses while another challenge is being investigated', () => {
    const curation = parked([finding('f-1', 'investigating'), finding('f-2')], 'challenging')
    expect(decideChallengeAdmission(curation, 'f-2')).toStrictEqual({
      admitted: false,
      reason: 'challenging',
    })
  })

  it('refuses a review that is not waiting on its findings, or carries none', () => {
    for (const status of ['reviewing', 'fixing', 'posting', 'done', 'skipped'] as const) {
      expect(decideChallengeAdmission(parked([finding('f-1')], status), 'f-1')).toStrictEqual({
        admitted: false,
        reason: 'not_parked',
      })
    }
    expect(decideChallengeAdmission(null, 'f-1')).toStrictEqual({
      admitted: false,
      reason: 'not_parked',
    })
  })

  it('refuses a finding the review does not carry', () => {
    expect(decideChallengeAdmission(parked([finding('f-1')]), 'f-9')).toStrictEqual({
      admitted: false,
      reason: 'unknown_finding',
    })
  })

  it('refuses a second challenge of a finding that already has a verdict', () => {
    for (const verdict of ['upheld', 'amended', 'retracted'] as const) {
      expect(decideChallengeAdmission(parked([finding('f-1', verdict)]), 'f-1')).toStrictEqual({
        admitted: false,
        reason: 'already_challenged',
        verdict,
      })
    }
  })

  it('lets a finding whose challenge failed be challenged again', () => {
    expect(decideChallengeAdmission(parked([finding('f-1', 'failed')]), 'f-1')).toStrictEqual({
      admitted: true,
    })
  })

  it('stops at the limit of answered challenges, not counting failures', () => {
    const answered = Array.from({ length: AI_REVIEW_CHALLENGE_LIMIT }, (_, i) =>
      finding(`answered-${i}`, 'upheld'),
    )
    expect(decideChallengeAdmission(parked([...answered, finding('next')]), 'next')).toStrictEqual({
      admitted: false,
      reason: 'review_limit',
    })

    const oneShort = answered.slice(1)
    const failed = finding('failed', 'failed')
    expect(
      decideChallengeAdmission(parked([...oneShort, failed, finding('next')]), 'next'),
    ).toStrictEqual({ admitted: true })
  })
})

describe('retractedFindingIds', () => {
  it('names only the findings a challenge retracted', () => {
    const curation = parked([
      finding('kept'),
      finding('gone', 'retracted'),
      finding('held', 'upheld'),
    ])
    expect([...retractedFindingIds(curation)]).toStrictEqual(['gone'])
    expect(retractedFindingIds(null).size).toBe(0)
  })
})

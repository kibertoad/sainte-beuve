import type { AiReviewCuration, AiReviewFinding } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { aiReviewRating, judgeAiReview } from './aiReviewGate.js'

const GATE = { blockingSeverity: 'high', minAiReviewRating: 0.8 } as const

function finding(
  severity: AiReviewFinding['severity'],
  id: string = severity,
  retracted = false,
): AiReviewFinding {
  return {
    findingId: id,
    title: 't',
    detail: 'd',
    path: 'a.ts',
    line: 1,
    side: 'RIGHT',
    severity,
    category: 'correctness',
    suggestedFix: null,
    sliceId: null,
    challenge: retracted ? { status: 'retracted', question: null, justification: 'wrong' } : null,
  }
}

function curation(findings: AiReviewFinding[]): AiReviewCuration {
  return {
    status: 'awaiting_selection',
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
    maxResumeAttempts: 2,
    summary: null,
    slices: [],
  }
}

function parked(findings: AiReviewFinding[]) {
  return { status: 'awaiting_selection', curation: curation(findings) } as const
}

describe('aiReviewRating', () => {
  it('rates a review with nothing found, or nothing at all, as perfect', () => {
    expect(aiReviewRating(curation([]))).toBe(1)
    expect(aiReviewRating(null)).toBe(1)
  })

  it('takes off what each standing finding costs, to two places', () => {
    expect(aiReviewRating(curation([finding('medium', 'a'), finding('medium', 'b')]))).toBe(0.8)
    expect(aiReviewRating(curation([finding('high'), finding('low')]))).toBe(0.71)
  })

  it('never goes below zero, and ignores a retracted finding', () => {
    expect(aiReviewRating(curation([finding('blocker'), finding('high')]))).toBe(0)
    expect(aiReviewRating(curation([finding('blocker', 'x', true)]))).toBe(1)
  })
})

describe('judgeAiReview', () => {
  it('waits while the review is running, or reviewing inside a parked run', () => {
    expect(judgeAiReview({ status: 'running', curation: null }, GATE)).toBeNull()
    const reviewing = { ...curation([]), status: 'reviewing' } as const
    expect(judgeAiReview({ status: 'awaiting_selection', curation: reviewing }, GATE)).toBeNull()
  })

  it('passes at exactly the minimum rating, as cat-factory does', () => {
    const run = parked([finding('medium', 'a'), finding('medium', 'b')])
    expect(judgeAiReview(run, GATE)).toEqual({ outcome: 'clean', rating: 0.8 })
  })

  it('blocks below the minimum rating with nothing at the blocking severity', () => {
    const run = parked([finding('medium', 'a'), finding('medium', 'b'), finding('medium', 'c')])
    expect(judgeAiReview(run, GATE)).toEqual({
      outcome: 'blocked',
      rating: 0.7,
      reason: 'the AI review rated it 0.7, below the 0.8 the policy asks for',
    })
  })

  it('blocks on a finding at the blocking severity whatever the rating', () => {
    const lenient = { blockingSeverity: 'high', minAiReviewRating: 0 } as const
    expect(judgeAiReview(parked([finding('high')]), lenient)).toEqual({
      outcome: 'blocked',
      rating: 0.75,
      reason: 'the AI review found 1 finding at high or worse',
    })
  })

  it('blocks on a review that failed or was cancelled', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      expect(judgeAiReview({ status, curation: null }, GATE)).toMatchObject({ outcome: 'blocked' })
    }
  })

  it('judges a completed review by what it found', () => {
    expect(judgeAiReview({ status: 'completed', curation: null }, GATE)).toEqual({
      outcome: 'clean',
      rating: 1,
    })
    const posted = { status: 'completed', curation: curation([finding('blocker')]) } as const
    expect(judgeAiReview(posted, GATE)).toMatchObject({ outcome: 'blocked', rating: 0 })
  })
})

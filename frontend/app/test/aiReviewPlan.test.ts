import type { AiReviewCuration, AiReviewFinding, AiReviewRun } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  activityLine,
  applyLabel,
  initialDraft,
  journeyOf,
  planOf,
  planTally,
  progressFraction,
  reconcileDraft,
} from '../app/utils/aiReviewPlan'

function finding(findingId: string, overrides: Partial<AiReviewFinding> = {}): AiReviewFinding {
  return {
    findingId,
    title: 't',
    detail: 'd',
    path: 'a.ts',
    line: 1,
    side: 'RIGHT',
    severity: 'medium',
    category: 'correctness',
    suggestedFix: null,
    challenge: null,
    sliceId: null,
    ...overrides,
  }
}

function curation(overrides: Partial<AiReviewCuration> = {}): AiReviewCuration {
  return {
    status: 'awaiting_selection',
    findings: [],
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    sliceCount: 0,
    reportedSliceCount: 0,
    lastActivityAt: null,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
    summary: null,
    slices: [],
    ...overrides,
  }
}

function run(overrides: Partial<AiReviewRun> = {}): AiReviewRun {
  return {
    id: 'run-1',
    reviewId: 'review-1',
    status: 'running',
    catFactoryTaskId: 'task-1',
    catFactoryRunId: 'cf-run-1',
    catFactoryUrl: null,
    catFactoryWorkspaceId: null,
    summary: null,
    failureReason: null,
    curation: null,
    challengedFindingIds: [],
    requestedAt: 0,
    lastPolledAt: null,
    parkedAt: null,
    completedAt: null,
    progress: null,
    ...overrides,
  }
}

const RETRACTED = { status: 'retracted' as const, question: null, justification: 'no' }

describe('initialDraft', () => {
  it('opens on comments with the blockers and highs picked', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker' }), finding('b', { severity: 'nit' })],
    })
    expect(initialDraft(state)).toStrictEqual({
      outcome: 'comment',
      picks: { a: true, b: false },
    })
  })

  it('opens on what cat-factory recorded', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker' }), finding('b')],
      selectedFindingIds: ['b'],
    })
    expect(initialDraft(state).picks).toStrictEqual({ a: false, b: true })
  })

  it('never starts a retracted finding picked', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker', challenge: RETRACTED })],
    })
    expect(initialDraft(state).picks).toStrictEqual({ a: false })
  })
})

describe('reconcileDraft', () => {
  it('keeps the outcome and the picks, defaults an arrival, and unpicks a retraction', () => {
    const findings = [
      finding('a'),
      finding('b', { severity: 'high' }),
      finding('c', { challenge: RETRACTED }),
    ]
    const held = { outcome: 'fix' as const, picks: { a: true, c: true, gone: true } }
    expect(reconcileDraft(findings, held)).toStrictEqual({
      outcome: 'fix',
      picks: { a: true, b: true, c: false },
    })
  })
})

describe('planOf', () => {
  const state = curation({ findings: [finding('a'), finding('b'), finding('c')] })
  const picks = { a: true, b: true, c: false }

  it('posts the picked findings as comments', () => {
    const plan = planOf(state, { outcome: 'comment', picks })
    expect(plan.resolution).toStrictEqual({ action: 'post', findingIds: ['a', 'b'] })
    expect(plan.left).toStrictEqual(['c'])
    expect(applyLabel(plan)).toBe('Post 2 comments')
    expect(planTally(plan)).toBe('2 to post · 1 skipped')
  })

  it('hands the picked findings to the fixer', () => {
    const plan = planOf(state, { outcome: 'fix', picks })
    expect(plan.resolution).toStrictEqual({ action: 'fix', findingIds: ['a', 'b'] })
    expect(applyLabel(plan)).toBe('Fix 2 findings')
    expect(planTally(plan)).toBe('2 to fix · 1 ignored')
  })

  it('closes with nothing picked, whatever the outcome', () => {
    const none = planOf(state, { outcome: 'fix', picks: {} })
    expect(none.resolution).toStrictEqual({ action: 'finish', findingIds: [] })
    expect(applyLabel(none)).toBe('Close without posting')
  })

  it('leaves a retracted finding out whatever it was set to', () => {
    const retracted = curation({ findings: [finding('a', { challenge: RETRACTED })] })
    expect(planOf(retracted, { outcome: 'fix', picks: { a: true } }).resolution.action).toBe(
      'finish',
    )
  })
})

describe('journeyOf', () => {
  const states = (r: AiReviewRun) => journeyOf(r).map((step) => `${step.key}:${step.state}`)

  it('puts a parked review on the curator', () => {
    expect(states(run({ status: 'awaiting_selection', curation: curation() }))).toStrictEqual([
      'filed:done',
      'reviewing:done',
      'deciding:current',
      'acting:upcoming',
      'done:upcoming',
    ])
  })

  it('marks the step a run stopped on as failed', () => {
    const failed = run({ status: 'failed', curation: curation({ status: 'fixing' }) })
    expect(states(failed)[3]).toBe('acting:failed')
  })

  it('reads a finished run as done all the way', () => {
    expect(journeyOf(run({ status: 'completed' })).every((step) => step.state === 'done')).toBe(
      true,
    )
  })
})

describe('activity', () => {
  it('counts slices while reviewing, and fills the bar from them', () => {
    const reviewing = run({
      curation: curation({ status: 'reviewing', sliceCount: 4, reportedSliceCount: 1 }),
    })
    expect(activityLine(reviewing)).toBe('1 of 4 slices reviewed.')
    expect(progressFraction(reviewing)).toBe(0.25)
  })

  it('reports the fixer by its own steps', () => {
    const fixing = run({
      curation: curation({ status: 'fixing' }),
      progress: {
        agentKind: 'pr-reviewer',
        state: 'working',
        fraction: 0.5,
        subtasks: { completed: 1, inProgress: 1, total: 3 },
      },
    })
    expect(activityLine(fixing)).toMatch(/1 of 3 steps done/)
    expect(progressFraction(fixing)).toBe(0.5)
  })

  it('does not read a settled review as still slicing', () => {
    const done = run({
      curation: curation({ status: 'done', sliceCount: 4, reportedSliceCount: 4 }),
    })
    expect(activityLine(done)).toBe('Wrapping up the run.')
  })

  it('says nothing is moving on a parked review', () => {
    expect(activityLine(run({ status: 'awaiting_selection', curation: curation() }))).toBeNull()
  })
})

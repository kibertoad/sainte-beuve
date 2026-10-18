import type { AiReviewCuration, AiReviewFinding, AiReviewRun } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  activityLine,
  applyLabel,
  initialChoices,
  journeyOf,
  planOf,
  progressFraction,
  reconcileChoices,
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
    fixFindingIds: [],
    combinesPostAndFix: true,
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

describe('initialChoices', () => {
  it('starts the blockers and highs on a comment and the rest on ignore', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker' }), finding('b', { severity: 'nit' })],
    })
    expect(initialChoices(state)).toStrictEqual({ a: 'comment', b: 'ignore' })
  })

  it('opens on what cat-factory recorded, fixes included', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker' }), finding('b'), finding('c')],
      selectedFindingIds: ['b'],
      fixFindingIds: ['c'],
    })
    expect(initialChoices(state)).toStrictEqual({ a: 'ignore', b: 'comment', c: 'fix' })
  })

  it('never starts a retracted finding on anything but ignore', () => {
    const state = curation({
      findings: [finding('a', { severity: 'blocker', challenge: RETRACTED })],
    })
    expect(initialChoices(state)).toStrictEqual({ a: 'ignore' })
  })
})

describe('reconcileChoices', () => {
  it('keeps what was chosen, defaults an arrival, and drops a retraction to ignore', () => {
    const findings = [
      finding('a'),
      finding('b', { severity: 'high' }),
      finding('c', { challenge: RETRACTED }),
    ]
    expect(reconcileChoices(findings, { a: 'fix', c: 'comment', gone: 'fix' })).toStrictEqual({
      a: 'fix',
      b: 'comment',
      c: 'ignore',
    })
  })
})

describe('planOf', () => {
  const state = curation({ findings: [finding('a'), finding('b'), finding('c')] })

  it('posts and queues the fixes in one resolution', () => {
    const plan = planOf(state, { a: 'comment', b: 'fix', c: 'ignore' })
    expect(plan.resolution).toStrictEqual({
      action: 'post',
      findingIds: ['a'],
      fixFindingIds: ['b'],
    })
    expect(plan.ignore).toStrictEqual(['c'])
    expect(applyLabel(plan)).toBe('Post 1 comment, then fix 1 finding')
  })

  it('refuses a split on an instance that cannot run one', () => {
    const plan = planOf(curation({ ...state, combinesPostAndFix: false }), {
      a: 'comment',
      b: 'fix',
    })
    expect(plan.resolution).toBeNull()
    expect(plan.blocked).toMatch(/cannot post comments and fix/)
  })

  it('fixes alone, posts alone, or closes with nothing chosen', () => {
    expect(planOf(state, { a: 'fix', b: 'fix' }).resolution).toStrictEqual({
      action: 'fix',
      findingIds: ['a', 'b'],
    })
    expect(planOf(state, { c: 'comment' }).resolution).toStrictEqual({
      action: 'post',
      findingIds: ['c'],
    })
    const none = planOf(state, {})
    expect(none.resolution).toStrictEqual({ action: 'finish', findingIds: [] })
    expect(applyLabel(none)).toBe('Close without posting')
  })

  it('leaves a retracted finding out whatever it was set to', () => {
    const retracted = curation({ findings: [finding('a', { challenge: RETRACTED })] })
    expect(planOf(retracted, { a: 'fix' }).resolution?.action).toBe('finish')
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

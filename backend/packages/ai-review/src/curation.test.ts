import type { PublicDecisionList, PublicRun } from '@cat-factory/sdk'
import type { ResolveAiReview } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { curationOf } from './curation.js'
import { progressOf } from './progress.js'
import { resolutionBodyOf } from './resolution.js'

/**
 * The projections from cat-factory's run and decision onto the review screen's
 * journey: progress, the slice count, the fix queue, and the resolution body.
 * The wire round trip is the gateway suite's; these are the rules.
 */
const REVIEWER_STEP = {
  agentKind: 'pr-reviewer',
  state: 'working',
  progress: 0.4,
  subtasks: { completed: 2, inProgress: 1, total: 5 },
  output: null,
  data: null,
} as const

function run(steps: unknown[] = [REVIEWER_STEP]): PublicRun {
  return { runId: 'run-1', taskId: 'task-1', status: 'running', currentStep: 0, steps } as never
}

function decisions(overrides: Record<string, unknown> = {}): PublicDecisionList {
  return {
    runId: 'run-1',
    decisions: [
      {
        kind: 'pr-review',
        status: 'reviewing',
        findings: [],
        selectedFindingIds: [],
        postedFindingIds: [],
        postedBody: false,
        postAttempts: 0,
        postReport: null,
        prUrl: null,
        slices: [],
        reportedSlices: 2,
        resumeAttempts: 0,
        maxResumeAttempts: 3,
        lastActivityAt: null,
        summary: null,
        ...overrides,
      },
    ],
  } as never
}

function resolution(overrides: Partial<ResolveAiReview> = {}): ResolveAiReview {
  return { action: 'post', findingIds: ['f-1'], fixFindingIds: [], ...overrides }
}

describe('progressOf', () => {
  it('reports the step the run is on', () => {
    expect(progressOf(run())).toStrictEqual({
      agentKind: 'pr-reviewer',
      state: 'working',
      fraction: 0.4,
      subtasks: { completed: 2, inProgress: 1, total: 5 },
    })
  })

  it('answers null for a run that names a step it does not carry', () => {
    expect(progressOf(run([]))).toBeNull()
  })
})

describe('curationOf', () => {
  it('counts the slices off the reviewer to-do list until the slicing is recorded', () => {
    expect(curationOf(decisions(), progressOf(run()))?.sliceCount).toBe(5)
  })

  it('counts the recorded slicing once there is one', () => {
    const slice = { sliceId: 's-1', title: 'polling', rationale: 'the loop', paths: ['a.ts'] }
    const state = curationOf(decisions({ status: 'awaiting_selection', slices: [slice] }))
    expect(state?.sliceCount).toBe(1)
    expect(state?.slices).toStrictEqual([slice])
  })

  it('reads an instance without a fix queue as unable to combine', () => {
    const state = curationOf(decisions())
    expect(state?.fixFindingIds).toStrictEqual([])
    expect(state?.combinesPostAndFix).toBe(false)
  })

  it('reads the fix queue, and an instance that serves one as able to combine', () => {
    const state = curationOf(decisions({ status: 'posting', fixFindingIds: ['f-2'] }))
    expect(state?.fixFindingIds).toStrictEqual(['f-2'])
    expect(state?.combinesPostAndFix).toBe(true)
  })
})

describe('resolutionBodyOf', () => {
  it('queues the findings to fix behind the post', () => {
    expect(resolutionBodyOf(resolution({ fixFindingIds: ['f-2'] }))).toStrictEqual({
      action: 'post',
      findingIds: ['f-1'],
      fixFindingIds: ['f-2'],
    })
  })

  it('sends a plain post the way an older instance reads it', () => {
    expect(resolutionBodyOf(resolution())).toStrictEqual({ action: 'post', findingIds: ['f-1'] })
  })
})

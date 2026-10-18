import {
  type AiReviewCuration,
  type AiReviewFinding,
  defaultRiskPolicy,
  type RiskPolicy,
  type RiskVerdict,
} from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { type ApprovalContext, aiReviewOutcome, planApproval } from './approval.js'

const OPEN: ApprovalContext['pullRequest'] = {
  state: 'open',
  draft: false,
  headSha: 'abc',
  authorLogin: 'ada',
}

function context(
  overrides: Partial<ApprovalContext> = {},
  policy: Partial<RiskPolicy> = {},
): ApprovalContext {
  return {
    provider: 'github',
    policy: { ...defaultRiskPolicy(), assess: true, autoApprove: true, ...policy },
    verdict: {
      outcome: 'within_policy',
      reason: 'within_thresholds',
      exceededAxes: [],
      policyName: 'native',
    },
    assessedHeadSha: 'abc',
    pullRequest: OPEN,
    repositoryHeld: true,
    approver: { username: 'approver-bot' },
    aiReview: null,
    ...overrides,
  }
}

describe('planApproval', () => {
  it('approves a pull request within policy', () => {
    expect(planApproval(context())).toEqual({ kind: 'approve' })
  })

  it('never approves in a repository this org does not hold', () => {
    expect(planApproval(context({ repositoryHeld: false }))).toEqual({
      kind: 'hold',
      status: 'within_policy',
      reason: 'its repository is not registered to this org',
    })
  })

  it('holds one outside policy for a person', () => {
    const verdict: RiskVerdict = {
      outcome: 'requires_review',
      reason: 'exceeded_thresholds',
      exceededAxes: ['risk'],
      policyName: 'native',
    }
    expect(planApproval(context({ verdict }))).toEqual({
      kind: 'hold',
      status: 'requires_review',
      reason: null,
    })
  })

  it('approves nothing while automatic approval is off', () => {
    expect(planApproval(context({}, { autoApprove: false }))).toMatchObject({
      kind: 'hold',
      reason: 'automatic approval is off',
    })
  })

  it('assesses again when the head moved since the verdict', () => {
    expect(planApproval(context({ pullRequest: { ...OPEN, headSha: 'def' } }))).toEqual({
      kind: 'reassess',
    })
  })

  it.each<[string, Partial<ApprovalContext>, string]>([
    ['no approver', { approver: null }, 'no approver is configured for GitHub'],
    ['the author approving', { approver: { username: 'ada' } }, 'the approver opened'],
    ['a draft', { pullRequest: { ...OPEN, draft: true } }, 'draft'],
    ['a merged one', { pullRequest: { ...OPEN, state: 'merged' } }, 'no longer open'],
  ])('holds %s', (_name, overrides, reason) => {
    const step = planApproval(context(overrides))
    expect(step).toMatchObject({ kind: 'hold', status: 'within_policy' })
    expect(step.kind === 'hold' ? step.reason : null).toContain(reason)
  })

  it('asks for an AI review first when the policy requires one', () => {
    const requiring = { requireAiReview: true }
    expect(planApproval(context({}, requiring))).toEqual({ kind: 'ai_review' })
    expect(planApproval(context({ aiReview: 'clean' }, requiring))).toEqual({ kind: 'approve' })
    expect(planApproval(context({ aiReview: 'blocked' }, requiring))).toMatchObject({
      kind: 'hold',
      status: 'requires_review',
    })
  })
})

function finding(severity: AiReviewFinding['severity'], retracted = false): AiReviewFinding {
  return {
    findingId: severity,
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

function parked(findings: AiReviewFinding[]): {
  status: 'awaiting_selection'
  curation: AiReviewCuration
} {
  return {
    status: 'awaiting_selection',
    curation: {
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
      fixFindingIds: [],
      combinesPostAndFix: false,
    },
  }
}

describe('aiReviewOutcome', () => {
  it('waits while the review is running', () => {
    expect(aiReviewOutcome({ status: 'running', curation: null }, 'medium')).toBeNull()
  })

  it('is clean when nothing reaches the threshold', () => {
    expect(aiReviewOutcome(parked([finding('low'), finding('nit')]), 'medium')).toBe('clean')
  })

  it('is blocked by a finding at or above the threshold', () => {
    expect(aiReviewOutcome(parked([finding('medium')]), 'medium')).toBe('blocked')
  })

  it('ignores a finding its challenge retracted', () => {
    expect(aiReviewOutcome(parked([finding('blocker', true)]), 'medium')).toBe('clean')
  })

  it('blocks on a review that failed', () => {
    expect(aiReviewOutcome({ status: 'failed', curation: null }, 'medium')).toBe('blocked')
  })

  it('blocks on a review a person completed by posting its findings', () => {
    const { curation } = parked([finding('high')])
    expect(aiReviewOutcome({ status: 'completed', curation }, 'medium')).toBe('blocked')
  })

  it('is clean when a review completed without findings', () => {
    expect(aiReviewOutcome({ status: 'completed', curation: null }, 'medium')).toBe('clean')
  })
})

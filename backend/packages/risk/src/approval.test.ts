import { defaultRiskPolicy, type RiskPolicy, type RiskVerdict } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { type ApprovalContext, planApproval } from './approval.js'

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
    const clean = { outcome: 'clean', rating: 0.9 } as const
    expect(planApproval(context({ aiReview: clean }, requiring))).toEqual({ kind: 'approve' })
    const blocked = { outcome: 'blocked', rating: 0.7, reason: 'rated 0.7' } as const
    expect(planApproval(context({ aiReview: blocked }, requiring))).toEqual({
      kind: 'hold',
      status: 'requires_review',
      reason: 'rated 0.7',
    })
  })
})

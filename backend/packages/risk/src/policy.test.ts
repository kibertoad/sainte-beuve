import { defaultRiskPolicy, type RiskPolicy } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { evaluateRiskPolicy } from './policy.js'

function policy(overrides: Partial<RiskPolicy> = {}): RiskPolicy {
  return { ...defaultRiskPolicy(), maxComplexity: 0.5, maxRisk: 0.4, maxImpact: 0.5, ...overrides }
}

const LOW = { complexity: 0.1, risk: 0.1, impact: 0.1 }
const RISKY = { complexity: 0.1, risk: 0.6, impact: 0.1 }

describe('evaluateRiskPolicy', () => {
  it('is within policy when every score is at or under its ceiling', () => {
    expect(evaluateRiskPolicy({ changeClass: 'source', scores: LOW }, policy())).toEqual({
      outcome: 'within_policy',
      reason: 'within_thresholds',
      exceededAxes: [],
      policyName: 'native',
    })
  })

  it('names the axes over their ceiling', () => {
    expect(evaluateRiskPolicy({ changeClass: 'source', scores: RISKY }, policy())).toMatchObject({
      outcome: 'requires_review',
      reason: 'exceeded_thresholds',
      exceededAxes: ['risk'],
    })
  })

  it('lets an always rule through whatever the scores', () => {
    const verdict = evaluateRiskPolicy(
      { changeClass: 'docs', scores: RISKY },
      policy({ classRules: { docs: 'always' } }),
    )
    expect(verdict).toMatchObject({ outcome: 'within_policy', reason: 'class_auto_approve' })
  })

  it('holds a never rule whatever the scores', () => {
    const verdict = evaluateRiskPolicy(
      { changeClass: 'schema', scores: LOW },
      policy({ classRules: { schema: 'never' } }),
    )
    expect(verdict).toMatchObject({ outcome: 'requires_review', reason: 'class_requires_review' })
  })

  it('compares scores for an unknown class, rules or not', () => {
    const verdict = evaluateRiskPolicy(
      { changeClass: 'unknown', scores: RISKY },
      policy({ classRules: { source: 'always' } }),
    )
    expect(verdict.reason).toBe('exceeded_thresholds')
  })
})

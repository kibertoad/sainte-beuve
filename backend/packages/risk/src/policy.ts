import type {
  ChangeClass,
  ChangeClassRule,
  ChangeClassRules,
  RiskAxis,
  RiskPolicy,
  RiskScores,
  RiskVerdict,
} from '@sainte-beuve/contracts'
import { RISK_AXES } from '@sainte-beuve/contracts'

/** The verdict a native policy puts on a native or cat-factory reading. */
export const NATIVE_POLICY_NAME = 'native'

/** The rule for one class; `unknown` and an unnamed class compare scores. */
export function classRuleFor(rules: ChangeClassRules, changeClass: ChangeClass): ChangeClassRule {
  if (changeClass === 'unknown') return 'thresholds'
  return rules[changeClass] ?? 'thresholds'
}

/** The axes whose score is above the policy's ceiling for it. */
export function exceededAxes(scores: RiskScores, policy: RiskPolicy): RiskAxis[] {
  const ceilings: Record<RiskAxis, number> = {
    complexity: policy.maxComplexity,
    risk: policy.maxRisk,
    impact: policy.maxImpact,
  }
  return RISK_AXES.filter((axis) => scores[axis] > ceilings[axis])
}

/**
 * Judge a reading by the org's own policy: a class rule first, the ceilings
 * when the class has none. The order cat-factory judges its own merges in.
 */
export function evaluateRiskPolicy(
  reading: { changeClass: ChangeClass; scores: RiskScores },
  policy: RiskPolicy,
): RiskVerdict {
  const rule = classRuleFor(policy.classRules, reading.changeClass)
  const exceeded = exceededAxes(reading.scores, policy)
  if (rule === 'never') {
    return verdict('requires_review', 'class_requires_review', exceeded)
  }
  if (rule === 'always') return verdict('within_policy', 'class_auto_approve', exceeded)
  return exceeded.length === 0
    ? verdict('within_policy', 'within_thresholds', exceeded)
    : verdict('requires_review', 'exceeded_thresholds', exceeded)
}

function verdict(
  outcome: RiskVerdict['outcome'],
  reason: RiskVerdict['reason'],
  exceeded: RiskAxis[],
): RiskVerdict {
  return { outcome, reason, exceededAxes: exceeded, policyName: NATIVE_POLICY_NAME }
}

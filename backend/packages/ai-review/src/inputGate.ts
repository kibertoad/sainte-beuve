import type {
  PublicDecisionList,
  PublicInputGateDecision,
  PublicInputGateDecisionIssue,
} from '@cat-factory/sdk'

/**
 * Why cat-factory's input gate is holding a review task, or null when it is not.
 *
 * The gate parks a run before its first model call when the task cannot be acted
 * on, and asks a person to fix the task in cat-factory and recheck it. Nobody
 * looking at sainte-beuve can do that, and the run reports `waiting_decision`
 * exactly as one with findings ready does, so without this it reads as a review
 * still working, for ever.
 */
export function inputGateRefusal(list: PublicDecisionList): string | null {
  const gate = list.decisions.find(
    (entry): entry is PublicInputGateDecision => entry.kind === 'input-gate',
  )
  if (gate === undefined || gate.status !== 'blocked') return null
  const blocking = gate.issues.filter((issue) => issue.severity === 'blocking').map(describe)
  const reasons = blocking.length > 0 ? blocking.join('; ') : 'it gave no reason'
  return `cat-factory refused the review task's input: ${reasons}`
}

function describe(issue: PublicInputGateDecisionIssue): string {
  switch (issue.code) {
    case 'review_target_missing':
      return 'the task names no pull request to review'
    case 'required_field_missing':
      return `the task's "${issue.field?.label ?? 'required'}" field is empty`
    default:
      return issue.code
  }
}

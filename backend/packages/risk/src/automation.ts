import type { RiskAssessment, RiskPolicy } from '@sainte-beuve/contracts'
import { RISK_ASSESSMENT_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'

/** What tracking a pull request sets off, unprompted. */
export interface TrackedAutomation {
  /** Assess it, starting its assessment over if it has one. */
  assess: boolean
  /** File cat-factory's AI review of it. */
  aiReview: boolean
}

export interface TrackedEvent {
  policy: Pick<RiskPolicy, 'assess' | 'autoAiReview'>
  /** The board opened its row on this event. */
  created: boolean
  /** It just became a review request: opened as a non-draft, or out of draft. */
  ready: boolean
  /** Where its assessment stands, or null when it has none. */
  assessment: Pick<RiskAssessment, 'status'> | null
}

const IN_FLIGHT = new Set<RiskAssessment['status']>(RISK_ASSESSMENT_IN_FLIGHT_STATUSES)

/**
 * Whether a tracked pull request needs assessing again because it became ready.
 * One already in flight is left to finish. One approved is left alone: its head
 * did not move, or it would have been an `assess` event, and the approval is
 * still about the code it has.
 */
function reassessOnReady(assessment: TrackedEvent['assessment']): boolean {
  return (
    assessment === null || (!IN_FLIGHT.has(assessment.status) && assessment.status !== 'approved')
  )
}

/**
 * What the policy asks for when the board tracks a pull request. A row the board
 * just opened is assessed whatever opened it. Becoming ready assesses one the
 * board already held too, since a draft is held for a person whatever it scores,
 * and it is the only event that files the AI review unprompted.
 */
export function planTrackedAutomation(event: TrackedEvent): TrackedAutomation {
  const { policy, created, ready } = event
  const assess = policy.assess && (created || (ready && reassessOnReady(event.assessment)))
  return { assess, aiReview: policy.autoAiReview && ready }
}

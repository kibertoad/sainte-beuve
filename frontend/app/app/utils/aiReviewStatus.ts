import type { AiReviewStatus } from '@sainte-beuve/contracts'
import { AI_REVIEW_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'

type BadgeColor = 'error' | 'warning' | 'info' | 'success' | 'neutral'

/** Whether a run can still change by itself or by somebody's choice, which is what to poll for. */
export function isInFlight(run: { status: AiReviewStatus }): boolean {
  return AI_REVIEW_IN_FLIGHT_STATUSES.includes(run.status)
}

/**
 * Whether a machine is working on the run, which earns the fast cadence. A
 * parked run waits on a person, and only an action on it moves it.
 */
export function isWorking(run: { status: AiReviewStatus }): boolean {
  return isInFlight(run) && run.status !== 'awaiting_selection'
}

export const aiReviewStatusColor: Record<AiReviewStatus, BadgeColor> = {
  requested: 'neutral',
  running: 'info',
  // The one status that is waiting on a PERSON, so it reads like the others do
  // not: everything else is a report, and this is a request.
  awaiting_selection: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

export const aiReviewStatusLabel: Record<AiReviewStatus, string> = {
  requested: 'filed',
  running: 'working',
  awaiting_selection: 'waiting on you',
  completed: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}

import { AI_REVIEW_IN_FLIGHT_STATUSES, type AiReviewRun } from '@sainte-beuve/contracts'

/**
 * WHETHER ONE MORE AI REVIEW MAY BE FILED ON A REVIEW, decided over the runs it
 * already has.
 *
 * A run is a billed cat-factory job, and every way to ask for one (the board's
 * button, the AI-review label, `@bot ai`, `/review ai`) is one gesture from a
 * person who does not pay for it. So the question is asked in one place, below
 * every surface, rather than as a guard on each:
 *
 *  1. ONE AT A TIME. A review with a run still in flight gets no second one: it
 *     has an answer coming, and a second run on the same pull request is the
 *     same money spent on the same question.
 *  2. A FEW AN HOUR. Past {@link AI_REVIEW_HOURLY_LIMIT} runs FILED in the last
 *     hour, the next waits. One-at-a-time alone would still let a loop re-file
 *     the moment each run settles.
 *
 * Only a FILED run counts toward the hourly limit: one cat-factory refused at
 * the door cost nothing, and counting it would lock a team out for an hour for
 * a misconfiguration somebody has just fixed.
 *
 * No run blocks a review for good. One still `requested` with no task is in
 * flight only for {@link AI_REVIEW_FILING_TIMEOUT_MS}, because a process that died
 * between writing the row and hearing back leaves nothing to poll. One cat-factory
 * did take is in flight for at most {@link AI_REVIEW_IN_FLIGHT_CEILING_MS}: a task
 * cat-factory lost reads as "no run yet" on every poll, and a parked review nobody
 * curates never settles, so without a ceiling either would refuse every later
 * request on that review.
 */

/** How many runs one review may file in an hour. */
export const AI_REVIEW_HOURLY_LIMIT = 3

const HOUR_MS = 60 * 60 * 1000

/**
 * How long a run still `requested`, with no cat-factory task, counts as alive.
 * Admission stops counting it after this, and the reminder sweep writes it off.
 *
 * Generous on purpose: it only has to outlast the one call that moves a run out
 * of `requested`, and a Worker's whole wall-clock budget is a fraction of it.
 */
export const AI_REVIEW_FILING_TIMEOUT_MS = 5 * 60 * 1000

/**
 * The longest a filed run holds a review's one place in flight. An hour, so a run
 * that outlives it has also left the hourly count, and the hourly limit is what
 * bounds what a stuck run lets through.
 */
export const AI_REVIEW_IN_FLIGHT_CEILING_MS = HOUR_MS

const IN_FLIGHT = new Set(AI_REVIEW_IN_FLIGHT_STATUSES)

/** The fields of a run the decision reads. */
export type AdmissionRun = Pick<AiReviewRun, 'status' | 'catFactoryTaskId' | 'requestedAt'>

export type AiReviewAdmission =
  | { admitted: true }
  | { admitted: false; reason: 'in_flight' }
  | { admitted: false; reason: 'hourly_limit'; retryAt: number }

export function decideAiReviewAdmission(
  runs: readonly AdmissionRun[],
  now: number,
): AiReviewAdmission {
  if (runs.some((run) => isInFlight(run, now))) return { admitted: false, reason: 'in_flight' }
  const filed = runs
    .filter((run) => run.catFactoryTaskId !== null && now - run.requestedAt < HOUR_MS)
    .map((run) => run.requestedAt)
    .sort((left, right) => left - right)
  if (filed.length < AI_REVIEW_HOURLY_LIMIT) return { admitted: true }
  // The oldest run that still counts is the one whose hour ends first.
  const oldest = filed[filed.length - AI_REVIEW_HOURLY_LIMIT] ?? now
  return { admitted: false, reason: 'hourly_limit', retryAt: oldest + HOUR_MS }
}

function isInFlight(run: AdmissionRun, now: number): boolean {
  if (!IN_FLIGHT.has(run.status)) return false
  const age = now - run.requestedAt
  if (run.catFactoryTaskId !== null) return age < AI_REVIEW_IN_FLIGHT_CEILING_MS
  return age < AI_REVIEW_FILING_TIMEOUT_MS
}

import type { AiReviewCuration, AiReviewRun } from '@sainte-beuve/contracts'
import type { AiReviewReport } from '@sainte-beuve/kernel'

/**
 * What a poll's report reconciles with the row it lands on.
 *
 * Pure, and separate from `AiReviewService` for that reason: polls overlap, so
 * "which of these two pictures of the review is the newer one" is a decision
 * over data with no store and no clock in it, and it is the part worth reading
 * on its own.
 */

/**
 * The curation a poll writes.
 *
 * It KEEPS what the row already holds when the report carries none. cat-factory
 * drops the decision from a run's list the moment the loop it belongs to
 * settles, so the poll that sees a review finish is the poll that sees no
 * decision. Writing that through would destroy the post receipt, the findings and
 * the recorded selection at exactly the moment somebody wants to read what
 * landed, and nothing could recover them: the receipt would only ever be visible
 * in the accidental window between the post and the run settling.
 *
 * It also keeps what the row holds when the report is OLDER than it. Two polls
 * of one run are in flight at once whenever a read and the clock overlap, and
 * since the clock now polls parked runs on a schedule, they overlap with the
 * curation verbs too: a `post` writes the receipt and a poll that started before
 * it answers with the curation as it was beforehand. Written through, that erases
 * the receipt for a pass that really did reach the pull request.
 */
export function curationFor(
  reported: AiReviewReport,
  current: AiReviewRun,
): AiReviewCuration | null {
  const next = reported.curation
  if (next === null) return current.curation
  const held = current.curation
  return held !== null && supersedes(held, next) ? held : next
}

/**
 * Whether what the row HOLDS is a later picture of the review than what a poll
 * REPORTS.
 *
 * Two fields move in one direction only, and they are the two this compares.
 * `postAttempts` counts the passes at posting that have run, so a report naming
 * fewer of them is a report from before the last one started. `lastActivityAt`
 * is cat-factory's own heartbeat, which stalls on a long silent turn but never
 * goes backwards, so a reading earlier than the one on the row is an older
 * reading.
 *
 * Unknown either way is NOT stale: a null heartbeat on either side says the
 * instance does not stamp one, not that the report is old, and the newer report
 * wins. That is the same answer this code gave before it compared anything, so
 * an instance reporting neither field is no worse off than it was.
 */
function supersedes(held: AiReviewCuration, reported: AiReviewCuration): boolean {
  if (held.postAttempts !== reported.postAttempts) return held.postAttempts > reported.postAttempts
  if (held.lastActivityAt === null || reported.lastActivityAt === null) return false
  return held.lastActivityAt > reported.lastActivityAt
}

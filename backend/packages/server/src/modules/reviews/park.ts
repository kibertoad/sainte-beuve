import type { AiReviewCuration, AiReviewRun, AiReviewStatus } from '@sainte-beuve/contracts'
import { type EpochMs, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { scheduleNextReminder } from '../../reminders/schedule.js'

/**
 * The park EDGE: when a delegated review stopped waiting on a model and started
 * waiting on a person, and what follows from that.
 *
 * Its own module because the two halves belong together and neither belongs in
 * `AiReviewService`. One is a pure decision over a poll's report and the row it
 * lands on, of the same kind `reconcile.ts` holds; the other is the only write on
 * the AI-review path that is not about an AI review at all — it moves the
 * REMINDER ladder, and it has to undo itself when it cannot.
 */

/**
 * A park that started or ended on one poll, and what the row said before it.
 *
 * `previous` is what makes the re-plan recoverable. The stamp is already on the
 * row by the time the ladder is touched, and it is also the only thing that tells
 * a later poll the park is news, so a re-plan that failed and left the stamp
 * standing would lose the announcement for good — there would be no edge left to
 * find. Put back, the next poll finds the edge again.
 */
export interface ParkEdge {
  reviewId: string
  runId: string
  previous: EpochMs | null
}

/**
 * What one poll left behind: the row, and the park edge it wrote if it wrote one.
 *
 * Here rather than on the service because the pair exists for the edge. A poll
 * could return the row alone if nothing followed from it; what makes the second
 * field necessary is that the edge is handed BACK instead of acted on where it is
 * found, because who re-plans is a question about the caller. A read polls every
 * run of one review at once and the ladder is one row, so it re-plans once for all
 * of them; the clock walks a batch of unrelated runs and re-plans each.
 */
export interface PollOutcome {
  /** The row after the poll, or null when there was nothing to ask about. */
  run: AiReviewRun | null
  park: ParkEdge | null
}

/** A run there was nothing to ask cat-factory about. */
export const NOT_POLLED: PollOutcome = { run: null, park: null }

/** Every park edge a batch of polls produced, in the order they were polled. */
export function parksIn(polled: readonly PollOutcome[]): ParkEdge[] {
  return polled.flatMap((outcome) => (outcome.park === null ? [] : [outcome.park]))
}

/**
 * When this run parked on its findings, as the poll leaves it.
 *
 * Stamped on the EDGE rather than on every poll that finds the run parked: the
 * ladder counts the wait from here and decides whether a nudge already went out
 * about this park by comparing against it, so a timestamp that moved every time
 * the clock looked would push the nudge out by a tick for ever and never send it.
 * Cleared the moment the run is anything else, because a curated, posting or
 * finished review is not waiting on anybody and `parkedSince` reads this field as
 * the answer to "is it now".
 *
 * Pure, with the reading passed in: whether a park is new is a decision over two
 * pictures of one run, and the clock is the only thing in it that is not data.
 */
export function parkedAtFor(
  current: AiReviewRun,
  next: { status: AiReviewStatus; curation: AiReviewCuration | null },
  now: EpochMs,
): EpochMs | null {
  if (next.status !== 'awaiting_selection') return null
  const held = current.parkedAt
  if (current.status !== 'awaiting_selection' || held === null) return now
  // A RE-PARK no poll ever saw leave. `resolve` answers 202 and cat-factory acts
  // asynchronously, so a post that starts and fails between two polls returns the
  // run to `awaiting_selection` having never been anything else on the row — and
  // the ladder, which asks whether a nudge went out after this stamp, would read
  // the second park as the first and say nothing about the receipt. The status is
  // too coarse to catch that; `postAttempts` is not, because it only ever goes up
  // (it is what `curationFor` decides staleness by), so a posting pass that has
  // run since the stamp is a park with something new to say.
  return postAttempts(next.curation) > postAttempts(current.curation) ? now : held
}

/** Posting passes this run has seen. None for a run carrying no review to curate. */
function postAttempts(curation: AiReviewCuration | null): number {
  return curation?.postAttempts ?? 0
}

/**
 * Put the review's ladder back in step with a park that just started or ended.
 *
 * A poll is the only thing that ever learns either fact — cat-factory calls
 * nothing back — and the reminder rows are written ahead of time, so without this
 * the nudge would be planned whenever something else happened to re-plan the
 * review, which for a review nobody is touching is never. The other half matters
 * as much: a park that ENDS takes the nudge off the schedule, so a review curated
 * ten minutes after it parked is not announced afterwards.
 *
 * ONE call for however many edges a pass produced, because `scheduleNextReminder`
 * is a cancel-then-create over a schedule that is meant to be a single row: two
 * runs on one review can park in the same read, and re-planning once per run
 * would cancel the same nothing twice and write two scheduled rows — a nudge sent
 * twice, and two rows where `snoozeReview` assumes one.
 *
 * It is also OUTSIDE the poll's own try/catch, which exists for a cat-factory
 * that cannot be reached: a reminder store that refused a write, recorded on the
 * run as "the AI review could not be read from cat-factory", is a receipt naming
 * the wrong system and a park that is then never announced.
 */
export async function replanForPark(
  container: AppContainer,
  edges: readonly ParkEdge[],
): Promise<void> {
  const [edge] = edges
  if (edge === undefined) return
  try {
    const review = await container.repositories.reviews.getById(edge.reviewId)
    if (review !== null) await scheduleNextReminder(container, review)
  } catch (err) {
    await unstamp(container, edges, err)
  }
}

/**
 * Put the park stamps back where they were, after a re-plan that could not write.
 *
 * A log line and a retry rather than a throw. The caller is a board read or one
 * run out of the clock's batch, and neither should fail because the reminder store
 * hiccuped — the same reason a poll that cat-factory refused leaves the row's
 * status alone. What makes that safe rather than silent is the restore: the stamp
 * is what tells a poll the park is news, so with it back the next poll finds the
 * edge again and re-plans, one wait later than it should have.
 */
async function unstamp(
  container: AppContainer,
  edges: readonly ParkEdge[],
  err: unknown,
): Promise<void> {
  const { repositories, logger } = container
  const [edge] = edges
  logger.warn(
    { reviewId: edge?.reviewId },
    `could not re-plan the reminders for a parked AI review: ${getErrorMessage(err)}`,
  )
  for (const { runId, previous } of edges) {
    await repositories.aiReviewRuns.update(runId, { parkedAt: previous })
  }
}

import type { Reminder } from '@sainte-beuve/contracts'
import type { EpochMs } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'
import { scheduleNextReminder } from './schedule.js'

/**
 * Put back the reminder ladders a dead sender left mid-step.
 *
 * `deliver` claims a due row before it posts anything, which is what stops two
 * ticks nudging the same person twice. What the claim cannot do is survive the
 * process: a Worker invocation that runs out of CPU, a container that is
 * rescheduled, a Node replica that is killed between the claim and the mark
 * leaves the row in `sending` for good.
 *
 * That is not one lost nudge. The policy hands out ONE reminder at a time and
 * `scheduleNextReminder` runs only when a delivery settles, so the stranded row
 * is the review's entire outstanding schedule: `listDue` reads `scheduled` and
 * never sees it again, `cancelScheduledForReview` filters on `scheduled` and
 * never clears it, and an open review nobody touches is quietly never chased
 * again — with nothing on the board saying why.
 *
 * So a claim is a LEASE. Older than any send could be, it is given up on:
 * `failed` with a reason, which is the same treatment an archived channel or a
 * removed bot gets and shows up in the same place, and then the ladder is
 * re-planned from the review.
 *
 * The rung comes round AGAIN, because the policy counts `sent` rows and this one
 * is not one. That is deliberate, and it is the opposite of the trade the claim
 * itself makes: a nudge is claimed before it is posted, so almost every stranded
 * row died before anything went out, and the narrow case that did post is one
 * repeat minutes later against a ladder that would otherwise have ended. A
 * second pass over a LIVE batch is what must never happen, and the lease is long
 * enough that it does not.
 */

/**
 * How old a claim has to be before the tick gives up on it.
 *
 * Above every bound a single delivery has: one `UPSTREAM_TIMEOUT_MS` post
 * (twenty seconds) plus a handful of indexed round trips, with room for a Worker
 * that is throttled or a store that is slow. It is also the Worker's whole cron
 * period, so a stranded row is recovered on the pass after the one that lost it
 * rather than by the one still running beside it.
 */
export const CLAIM_LEASE_MS = 5 * 60_000

/**
 * How many stranded claims one org recovers per pass.
 *
 * Its own cap rather than the tick's batch size, and smaller: a recovery is two
 * reads and three writes where a nudge is one post, and this is a repair path
 * that is empty on almost every pass. What the cap leaves over is taken next
 * tick, oldest claim first, so nothing is starved.
 */
const RECOVERY_BATCH = 20

/**
 * Recover this org's stranded claims. `container` is already bound to it.
 *
 * Returns how many were given up on, which the tick reports beside the nudges.
 *
 * It runs BEFORE the org's due read rather than as a passenger, so the rung it
 * re-plans — due in the past, and so due now — goes out in the same pass instead
 * of waiting for the next one.
 *
 * A recovery that fails does NOT fail the pass, exactly as the two passengers do
 * not: these rows have already waited out a lease, one more tick costs them
 * nothing, and a store that refused a write is not a reason to send no reminder
 * at all this minute.
 */
export async function recoverStalledClaims(container: AppContainer): Promise<number> {
  try {
    const stalled = await container.repositories.reminders.listStalledClaims(
      expiredBefore(container.clock.now()),
      RECOVERY_BATCH,
    )
    // SERIALLY, unlike the nudges beside it. Every recovery re-plans its
    // review's ladder, which is a cancel and a create, and two of those
    // overlapping on one review can leave it with two scheduled nudges or none
    // — the same hazard `lanesOf` exists for. This batch is rows nobody is
    // waiting on and is empty on almost every pass, so the latency it hides is
    // not worth a second lane map.
    let recovered = 0
    for (const reminder of stalled) if (await giveUp(container, reminder)) recovered += 1
    if (recovered > 0) container.logger.warn({ recovered }, 'recovered stranded reminder claims')
    return recovered
  } catch (err) {
    container.logger.warn({ err }, 'could not recover stranded reminder claims')
    return 0
  }
}

/** The instant a claim taken before is past its lease. */
function expiredBefore(now: EpochMs): EpochMs {
  return now - CLAIM_LEASE_MS
}

/** What the board says about a nudge whose sender never came back. */
const INTERRUPTED = 'the send was interrupted and did not finish; the reminder was re-planned'

/**
 * One stranded row: given up on, then its review's ladder re-planned. Returns
 * whether this pass was the one that did it.
 *
 * The give-up is CONDITIONAL, so two passes over the same stranded row — two
 * replicas, or a cron firing while the last invocation is still running — do not
 * both re-plan. A re-plan is a cancel and a create, and two of them would leave
 * the review with two scheduled nudges: the duplicate the claim exists to
 * prevent, put back by the thing that repairs it.
 *
 * In that order, too. The re-plan reads the review's reminders to decide the
 * next rung, so a row still sitting in `sending` would be read as a delivery in
 * flight; given up on first, the plan is made against what actually happened.
 *
 * A review that has since been deleted gets the `failed` row and no re-plan,
 * which is the same thing `deliver` does with a nudge whose review is gone.
 */
async function giveUp(container: AppContainer, reminder: Reminder): Promise<boolean> {
  if (!(await container.repositories.reminders.abandonClaim(reminder, INTERRUPTED))) return false
  const review = await container.repositories.reviews.getById(reminder.reviewId)
  if (review !== null) await scheduleNextReminder(container, review)
  return true
}

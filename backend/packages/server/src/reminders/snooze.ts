import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'

/**
 * Push the next nudge for a review out by a few hours.
 *
 * A snooze is not a cancel and not a policy change. The ladder the policy plans
 * stays exactly as it was; what moves is when the OUTSTANDING row comes due, so
 * the review is still chased, later. That is why this writes a row directly
 * rather than going through `scheduleNextReminder`: re-planning would compute the
 * same due time the policy computed before and undo the snooze on the spot.
 *
 * The scheduled row is replaced rather than edited, because the reminder port has
 * no update-the-due-date method and should not grow one for this: the outstanding
 * schedule for a review is a single row either way, and rewriting it is both
 * simpler and impossible to get out of step.
 */
export async function snoozeReview(
  container: AppContainer,
  review: ReviewRequest,
  hours: number,
): Promise<Reminder> {
  const { repositories, clock, ids } = container
  const outstanding = (await repositories.reminders.listByReview(review.id)).find(
    (reminder) => reminder.status === 'scheduled',
  )
  await repositories.reminders.cancelScheduledForReview(review.id)
  const now = clock.now()
  return repositories.reminders.create({
    id: ids.next(),
    reviewId: review.id,
    // The snoozed nudge keeps its KIND and its target. Somebody deferring a
    // reminder is not asking to be chased differently, and a snooze that turned a
    // DM into a channel post would widen the audience as a reward for asking for
    // time.
    ...(outstanding === undefined ? plannedTargetFor(review) : targetOf(outstanding)),
    dueAt: now + hours * 60 * 60 * 1000,
    status: 'scheduled',
    sentAt: null,
    failureReason: null,
    createdAt: now,
  })
}

/** The three fields that decide who hears the nudge and how. */
type ReminderTarget = Pick<Reminder, 'kind' | 'channel' | 'reviewerId'>

function targetOf(reminder: Reminder): ReminderTarget {
  return { kind: reminder.kind, channel: reminder.channel, reviewerId: reminder.reviewerId }
}

/**
 * Where the nudge would have gone, for a review with nothing outstanding to copy:
 * the ladder can be between rungs (the last nudge went out and the policy planned
 * nothing after it), and a snooze then has to invent the target.
 *
 * It invents the SAME one `planNextReminder` does, which is the only way the
 * invariant above holds: a channel post read out of an assigned review would
 * turn a private nudge into a public one.
 */
function plannedTargetFor(review: ReviewRequest): ReminderTarget {
  const [reviewerId] = review.assignedReviewerIds
  return reviewerId === undefined
    ? { kind: 'unassigned', channel: 'slack_channel', reviewerId: null }
    : { kind: 'pending', channel: 'slack_dm', reviewerId }
}

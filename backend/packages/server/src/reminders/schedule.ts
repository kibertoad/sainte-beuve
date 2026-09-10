import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { planNextReminder } from '@sainte-beuve/reminders'
import type { AppContainer } from '../container.js'

/**
 * Re-plan the reminder schedule for one review: drop what is outstanding and write
 * the single next nudge the policy asks for.
 *
 * Shared by the service and the tick because both change what should be chased. A
 * status write moves the ladder, and so does a nudge going out: the policy returns
 * at most one reminder ON THE UNDERSTANDING that somebody re-plans after each send,
 * so a caller that sends and does not come back here ends the ladder for good.
 *
 * Cancel-then-plan rather than diffing: the outstanding schedule is always a single
 * row, so rewriting it is both simpler and impossible to get out of step.
 */
export async function scheduleNextReminder(
  container: AppContainer,
  review: ReviewRequest,
): Promise<Reminder | null> {
  const { repositories, reminderPolicy, clock, ids } = container
  const sent = await repositories.reminders.listByReview(review.id)
  await repositories.reminders.cancelScheduledForReview(review.id)
  const planned = planNextReminder(review, reminderPolicy, sent)
  if (planned === null) return null
  return repositories.reminders.create({
    id: ids.next(),
    reviewId: planned.reviewId,
    kind: planned.kind,
    channel: planned.channel,
    reviewerId: planned.reviewerId,
    dueAt: planned.dueAt,
    status: 'scheduled',
    sentAt: null,
    failureReason: null,
    createdAt: clock.now(),
  })
}

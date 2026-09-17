import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { parkedSince, planNextReminder } from '@sainte-beuve/reminders'
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
 *
 * It reads the review's AI runs as well as its reminders, because one rung of
 * the ladder is about them: a delegated review that parks on its findings is
 * waiting on a person, and the only thing that ever learns it parked is a poll.
 * A second indexed read by `review_id`, on a path that already does one and
 * already writes.
 */
export async function scheduleNextReminder(
  container: AppContainer,
  review: ReviewRequest,
): Promise<Reminder | null> {
  const { repositories, reminderPolicy, clock, ids } = container
  // Together, because neither read depends on the other and this runs on a
  // runtime billed by wall-clock time on every status write and every send.
  const [sent, runs] = await Promise.all([
    repositories.reminders.listByReview(review.id),
    repositories.aiReviewRuns.listByReview(review.id),
  ])
  await repositories.reminders.cancelScheduledForReview(review.id)
  const planned = planNextReminder(review, reminderPolicy, sent, {
    aiReviewParkedAt: parkedSince(runs),
  })
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

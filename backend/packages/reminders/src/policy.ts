import type {
  Reminder,
  ReminderChannel,
  ReminderKind,
  ReminderPolicy,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '@sainte-beuve/kernel'

/**
 * Reminder policy: given a review and what has already been sent, what should be
 * scheduled next.
 *
 * Split from delivery deliberately. The policy is a pure function of the review,
 * the clock and the cadence, so the escalation ladder can be reasoned about and
 * tested without a Slack token; the runtime's tick reads `listDue` and sends.
 * Nothing here writes, and nothing here knows what a channel is beyond its name.
 */

/** A reminder the policy wants written, before an id and a store row exist. */
export interface PlannedReminder {
  reviewId: string
  kind: ReminderKind
  channel: ReminderChannel
  reviewerId: string | null
  dueAt: EpochMs
}

/** Statuses that stop the clock: the review has a verdict, so nudging is noise. */
const RESOLVED_STATUSES = new Set(['approved', 'changes_requested', 'closed'])

export function isResolved(review: ReviewRequest): boolean {
  return RESOLVED_STATUSES.has(review.status)
}

/**
 * A high-priority review is chased on half the normal cadence. One multiplier
 * rather than three separate ladders: the cadence a team tunes is the normal one,
 * and priority should bend it predictably instead of introducing a second set of
 * numbers to keep consistent.
 */
export function cadenceMultiplier(review: ReviewRequest): number {
  if (review.priority === 'high') return 0.5
  if (review.priority === 'low') return 2
  return 1
}

/**
 * When the next nudge for an UNASSIGNED review is due: a fixed wait from creation,
 * scaled by priority. Nobody owns this review yet, so the nudge goes to the channel.
 */
export function nextUnassignedReminderAt(review: ReviewRequest, policy: ReminderPolicy): EpochMs {
  return review.createdAt + policy.unassignedAfterMs * cadenceMultiplier(review)
}

/**
 * When the next nudge for an ASSIGNED reviewer is due. Counted from the assignment
 * for the first one and from the last nudge afterwards, so a review assigned and
 * then nudged does not fire twice for the same silence.
 */
export function nextPendingReminderAt(
  review: ReviewRequest,
  policy: ReminderPolicy,
  lastSentAt: EpochMs | null,
): EpochMs {
  const multiplier = cadenceMultiplier(review)
  if (lastSentAt !== null) return lastSentAt + policy.pendingRepeatMs * multiplier
  const from = review.assignedAt ?? review.createdAt
  return from + policy.pendingAfterMs * multiplier
}

/** How many `pending` nudges have already gone out for this review. */
function sentPendingCount(sent: readonly Reminder[]): number {
  return sent.filter((r) => r.kind === 'pending' && r.status === 'sent').length
}

function latestSentAt(sent: readonly Reminder[], kind: ReminderKind): EpochMs | null {
  const times = sent
    .filter((r) => r.kind === kind && r.status === 'sent' && r.sentAt !== null)
    .map((r) => r.sentAt as EpochMs)
  return times.length === 0 ? null : Math.max(...times)
}

/**
 * The single next reminder to schedule for a review, or null when there is nothing
 * to chase. Returns AT MOST one: the tick re-plans after each send, so a stalled
 * review cannot accumulate a queue of nudges that all fire at once when it wakes.
 *
 * Order matters. Escalation is checked first because a review past its deadline
 * needs the wider audience regardless of how many private nudges are left in the
 * budget, which is the case where the `maxPendingReminders` cap would otherwise
 * make the system go quiet exactly when it should get louder.
 */
export function planNextReminder(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
): PlannedReminder | null {
  if (isResolved(review)) return null

  if (review.dueAt !== null && latestSentAt(alreadySent, 'escalation') === null) {
    return {
      reviewId: review.id,
      kind: 'escalation',
      channel: 'slack_channel',
      reviewerId: null,
      dueAt: review.dueAt + policy.escalateAfterDueMs,
    }
  }

  if (review.assignedReviewerIds.length === 0) {
    if (latestSentAt(alreadySent, 'unassigned') !== null) return null
    return {
      reviewId: review.id,
      kind: 'unassigned',
      channel: 'slack_channel',
      reviewerId: null,
      dueAt: nextUnassignedReminderAt(review, policy),
    }
  }

  if (sentPendingCount(alreadySent) >= policy.maxPendingReminders) return null
  return {
    reviewId: review.id,
    kind: 'pending',
    channel: 'slack_dm',
    reviewerId: review.assignedReviewerIds[0] ?? null,
    dueAt: nextPendingReminderAt(review, policy, latestSentAt(alreadySent, 'pending')),
  }
}

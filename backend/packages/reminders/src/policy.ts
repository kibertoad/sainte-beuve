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
 * The wide nudge, due a fixed wait past the review's own deadline. Planned once:
 * widening the audience is a one-off event, and repeating it is how a channel
 * learns to mute the bot.
 */
function planEscalation(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
): PlannedReminder | null {
  if (review.dueAt === null) return null
  if (latestSentAt(alreadySent, 'escalation') !== null) return null
  return {
    reviewId: review.id,
    kind: 'escalation',
    channel: 'slack_channel',
    reviewerId: null,
    dueAt: review.dueAt + policy.escalateAfterDueMs,
  }
}

/**
 * The ordinary nudge: the channel while nobody owns the review, the assigned
 * reviewer's DM once somebody does, up to the pending budget.
 */
function planNudge(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
): PlannedReminder | null {
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

/**
 * The soonest candidate, or null when there is none. A tie goes to the first in the
 * list, the escalation: when a private nudge and a wide one fall due at the same
 * moment, the wide one is the answer and the private one is re-planned behind it.
 */
function earliest(candidates: readonly (PlannedReminder | null)[]): PlannedReminder | null {
  let soonest: PlannedReminder | null = null
  for (const candidate of candidates) {
    if (candidate === null) continue
    if (soonest === null || candidate.dueAt < soonest.dueAt) soonest = candidate
  }
  return soonest
}

/**
 * The single next reminder to schedule for a review, or null when there is nothing
 * to chase. Returns AT MOST one: the tick re-plans after each send, so a stalled
 * review cannot accumulate a queue of nudges that all fire at once when it wakes.
 *
 * Which one is decided by the clock, not by a precedence between kinds. An
 * escalation that is a week out must not silence the DM that is due tomorrow, and
 * once the pending budget is spent the escalation is the only candidate left, so it
 * is planned even though it is further away. That is the case the budget would
 * otherwise turn into silence exactly when the review most needs an audience.
 */
export function planNextReminder(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
): PlannedReminder | null {
  if (isResolved(review)) return null
  return earliest([
    planEscalation(review, policy, alreadySent),
    planNudge(review, policy, alreadySent),
  ])
}

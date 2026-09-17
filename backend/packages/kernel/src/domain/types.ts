import type { PullRequestRef, ReminderPolicy } from '@sainte-beuve/contracts'
import { formatPullRequestRef } from '@sainte-beuve/contracts'

/** Milliseconds since the epoch. Every timestamp on the wire and in a port is this. */
export type EpochMs = number

/**
 * The default reminder cadence: chase an unclaimed review after 4 hours, an
 * assigned-but-silent one after a working day, then every working day, and widen
 * the audience 24 hours past the deadline. Deployment-tunable (see
 * `reminderPolicySchema`), but these are the numbers a workspace starts on.
 *
 * The parked AI review is the one rung measured in minutes rather than hours,
 * because it is the only one that is not waiting on somebody's attention: the
 * findings exist, and fifteen minutes is long enough for whoever pressed the
 * button to still be on the row and short enough that nobody's afternoon is
 * spent beside a queue nothing announced.
 */
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  unassignedAfterMs: 4 * 60 * 60 * 1000,
  pendingAfterMs: 24 * 60 * 60 * 1000,
  pendingRepeatMs: 24 * 60 * 60 * 1000,
  escalateAfterDueMs: 24 * 60 * 60 * 1000,
  maxPendingReminders: 3,
  aiReviewParkedAfterMs: 15 * 60 * 1000,
}

/**
 * `owner/repo#number`, the form used in log lines and chat messages. The
 * contract owns the formatting so the SPA renders the same string; this is the
 * name the backend has always called it by.
 */
export function formatPullRequest(pr: PullRequestRef): string {
  return formatPullRequestRef(pr)
}

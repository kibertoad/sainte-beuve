import type { PullRequestRef, ReminderPolicy } from '@sainte-beuve/contracts'

/** Milliseconds since the epoch. Every timestamp on the wire and in a port is this. */
export type EpochMs = number

/**
 * The default reminder cadence: chase an unclaimed review after 4 hours, an
 * assigned-but-silent one after a working day, then every working day, and widen
 * the audience 24 hours past the deadline. Deployment-tunable (see
 * `reminderPolicySchema`), but these are the numbers a workspace starts on.
 */
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  unassignedAfterMs: 4 * 60 * 60 * 1000,
  pendingAfterMs: 24 * 60 * 60 * 1000,
  pendingRepeatMs: 24 * 60 * 60 * 1000,
  escalateAfterDueMs: 24 * 60 * 60 * 1000,
  maxPendingReminders: 3,
}

/** `owner/repo#number`, the form used in log lines and chat messages. */
export function formatPullRequest(pr: PullRequestRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`
}

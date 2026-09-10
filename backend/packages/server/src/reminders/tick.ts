import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'
import { resolveChat } from '../integrations/resolve.js'
import { scheduleNextReminder } from './schedule.js'

/**
 * One pass of the reminder clock: send what is due, record what happened, plan what
 * comes next.
 *
 * Runtime-neutral on purpose. The Worker drives it from a cron trigger and the Node
 * service from an interval, and neither owns the logic: the same code decides what
 * is due and the same code writes the result, so a reminder cannot behave
 * differently depending on where it is hosted.
 *
 * A batch cap rather than "drain the queue": a tick that tries to send a thousand
 * nudges will hit a Worker's CPU budget or a Slack rate limit halfway through, and
 * the half that succeeded is indistinguishable from the half that did not. Capped,
 * every tick finishes and the next one picks up the rest.
 */
const DEFAULT_BATCH = 50

export interface TickResult {
  sent: number
  failed: number
  skipped: number
}

export async function runReminderTick(
  container: AppContainer,
  batchSize: number = DEFAULT_BATCH,
): Promise<TickResult> {
  const due = await container.repositories.reminders.listDue(container.clock.now(), batchSize)
  const result: TickResult = { sent: 0, failed: 0, skipped: 0 }
  for (const reminder of due) {
    const outcome = await deliver(container, reminder)
    result[outcome] += 1
  }
  if (due.length > 0) {
    container.logger.info({ ...result, due: due.length }, 'reminder tick complete')
  }
  return result
}

async function deliver(
  container: AppContainer,
  reminder: Reminder,
): Promise<'sent' | 'failed' | 'skipped'> {
  const review = await container.repositories.reviews.getById(reminder.reviewId)
  if (review === null) {
    // Nothing left to chase, which is what `cancelled` means. Every other way a
    // nudge does not go out is a fault, and says so.
    await container.repositories.reminders.updateStatus(reminder.id, 'cancelled')
    return 'skipped'
  }
  const chat = await resolveChat(container)
  if (chat === null) return fail(container, reminder, 'chat is not configured for this deployment')
  const target = await resolveTarget(container, reminder)
  if (target === null) return fail(container, reminder, unresolvedTargetReason(reminder))
  try {
    await chat.gateway.sendReminder(reminder, review, target)
    return await markSent(container, reminder, review)
  } catch (err) {
    return fail(container, reminder, getErrorMessage(err))
  }
}

/**
 * Why the nudge has nowhere to go. An unconfigured chat gateway and a reviewer with
 * no Slack id are the two states a fresh deployment is in, and both are
 * configuration faults rather than reasons to forget the reminder: recorded on the
 * row, they are visible on the board and name what to fix.
 */
function unresolvedTargetReason(reminder: Reminder): string {
  return reminder.channel === 'slack_dm'
    ? 'the assigned reviewer has no Slack user id'
    : 'no announcement channel is configured (SLACK_CHANNEL_ID)'
}

async function fail(
  container: AppContainer,
  reminder: Reminder,
  failureReason: string,
): Promise<'failed'> {
  // Recorded on the row rather than only logged: a channel that has been archived
  // or a bot that was removed fails every time, and the failure has to be visible
  // on the board rather than in a log nobody reads.
  await container.repositories.reminders.updateStatus(reminder.id, 'failed', { failureReason })
  return 'failed'
}

/**
 * Mark the nudge sent, then plan the one after it. The re-plan is the half that
 * keeps the ladder moving: the policy hands out one reminder at a time, so without
 * it every review would get exactly one nudge in its lifetime.
 */
async function markSent(
  container: AppContainer,
  reminder: Reminder,
  review: ReviewRequest,
): Promise<'sent'> {
  await container.repositories.reminders.updateStatus(reminder.id, 'sent', {
    sentAt: container.clock.now(),
  })
  await scheduleNextReminder(container, review)
  return 'sent'
}

/** A DM goes to the reviewer's Slack id; anything else goes to the announcement channel. */
async function resolveTarget(container: AppContainer, reminder: Reminder): Promise<string | null> {
  if (reminder.channel !== 'slack_dm') return container.slack.announcementChannelId
  if (reminder.reviewerId === null) return null
  const reviewer = await container.repositories.reviewers.getById(reminder.reviewerId)
  return reviewer?.slackUserId ?? null
}

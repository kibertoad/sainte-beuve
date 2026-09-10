import type { Reminder } from '@sainte-beuve/contracts'
import { getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'

/**
 * One pass of the reminder clock: send what is due, record what happened.
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
  const target = await resolveTarget(container, reminder)
  if (container.chat === null || target === null) {
    await container.repositories.reminders.updateStatus(reminder.id, 'cancelled')
    return 'skipped'
  }
  const review = await container.repositories.reviews.getById(reminder.reviewId)
  if (review === null) {
    await container.repositories.reminders.updateStatus(reminder.id, 'cancelled')
    return 'skipped'
  }
  try {
    await container.chat.sendReminder(reminder, review, target)
    await container.repositories.reminders.updateStatus(reminder.id, 'sent', {
      sentAt: container.clock.now(),
    })
    return 'sent'
  } catch (err) {
    // Recorded on the row rather than only logged: a channel that has been
    // archived or a bot that was removed fails every time, and the failure has to
    // be visible on the board rather than in a log nobody reads.
    await container.repositories.reminders.updateStatus(reminder.id, 'failed', {
      failureReason: getErrorMessage(err),
    })
    return 'failed'
  }
}

/** A DM goes to the reviewer's Slack id; anything else goes to the announcement channel. */
async function resolveTarget(container: AppContainer, reminder: Reminder): Promise<string | null> {
  if (reminder.channel !== 'slack_dm') return container.announcementChannelId
  if (reminder.reviewerId === null) return null
  const reviewer = await container.repositories.reviewers.getById(reminder.reviewerId)
  return reviewer?.slackUserId ?? null
}

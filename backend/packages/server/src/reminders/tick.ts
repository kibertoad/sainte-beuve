import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { type ChatGateway, getErrorMessage } from '@sainte-beuve/kernel'
import { type AppContainer, withOrg } from '../container.js'
import { type CredentialSource, type Resolved, resolveChat } from '../integrations/resolve.js'
import { SessionService } from '../modules/auth/SessionService.js'
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
 *
 * It WALKS THE ORGS, one pass each, with the batch cap applied per tenancy. This
 * is the one caller in the tree that is not inside an org to begin with — a cron
 * trigger carries no credential — so it is also the one place `forOrg` is called
 * from anything but the authentication middleware. The alternative, a `listDue`
 * that reached across every tenancy, would be the single read that could return
 * another org's rows, on the one path with nobody to refuse it.
 */
const DEFAULT_BATCH = 50

export interface TickResult {
  sent: number
  failed: number
  skipped: number
  /**
   * Expired sessions dropped on the way past.
   *
   * It rides the reminder clock rather than having a clock of its own, because
   * this is the one periodic pass both runtimes already have: a sweep wired on
   * the Node interval and not on the Worker's cron would be exactly the
   * asymmetry this layout exists to prevent. A session that expires is refused
   * on read either way, so the sweep is about the table growing a row per
   * sign-in for ever rather than about correctness.
   */
  sessionsSwept: number
}

export async function runReminderTick(
  container: AppContainer,
  batchSize: number = DEFAULT_BATCH,
): Promise<TickResult> {
  const total: TickResult = { sent: 0, failed: 0, skipped: 0, sessionsSwept: 0 }
  for (const orgId of await tenancies(container)) {
    const pass = await tickOrg(withOrg(container, orgId), batchSize)
    total.sent += pass.sent
    total.failed += pass.failed
    total.skipped += pass.skipped
    total.sessionsSwept += pass.sessionsSwept
  }
  return total
}

/**
 * Every org, with the default one first and present whether or not its row
 * exists.
 *
 * A deployment that never made a second org has an empty `orgs` table and a full
 * board, so a tick driven off the table alone would send no reminder it ever
 * had to send. The `Set` is what keeps that from ticking the default org twice
 * once somebody does write the row.
 */
async function tenancies(container: AppContainer): Promise<string[]> {
  const stored = await container.stores.orgs.list()
  return [...new Set([DEFAULT_ORG_ID, ...stored.map((org) => org.id)])]
}

/** One org's pass. `container` is already bound to it. */
async function tickOrg(container: AppContainer, batchSize: number): Promise<TickResult> {
  const due = await container.repositories.reminders.listDue(container.clock.now(), batchSize)
  const result: TickResult = { sent: 0, failed: 0, skipped: 0, sessionsSwept: 0 }
  // Resolved ONCE for the batch, and once PER ORG: every reminder in this pass
  // goes out over this tenancy's own credential, and resolving per reminder
  // means re-reading the stored bot token, re-deriving its HKDF key and opening
  // the envelope again for each one, on a runtime billed by CPU time.
  const chat = due.length === 0 ? null : await resolveChat(container)
  for (const reminder of due) {
    const outcome = await deliver(container, reminder, chat)
    result[outcome] += 1
  }
  result.sessionsSwept = await sweepSessions(container)
  if (due.length > 0 || result.sessionsSwept > 0) {
    container.logger.info(
      { ...result, due: due.length, org: container.orgId },
      'reminder tick complete',
    )
  }
  return result
}

/**
 * A sweep that fails does NOT fail the tick. The reminders in this pass have
 * already gone out, and a store that refused a delete is a fault an operator
 * reads in the log rather than a reason to re-send every nudge next minute.
 */
async function sweepSessions(container: AppContainer): Promise<number> {
  try {
    return await new SessionService(container).sweepExpired()
  } catch (err) {
    container.logger.warn({ err }, 'could not sweep expired sessions')
    return 0
  }
}

async function deliver(
  container: AppContainer,
  reminder: Reminder,
  chat: Resolved<ChatGateway, CredentialSource> | null,
): Promise<'sent' | 'failed' | 'skipped'> {
  const review = await container.repositories.reviews.getById(reminder.reviewId)
  if (review === null) {
    // Nothing left to chase, which is what `cancelled` means. Every other way a
    // nudge does not go out is a fault, and says so.
    await container.repositories.reminders.updateStatus(reminder.id, 'cancelled')
    return 'skipped'
  }
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

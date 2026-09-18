import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { type ChatGateway, getErrorMessage } from '@sainte-beuve/kernel'
import { mapWithConcurrency } from '../concurrency.js'
import { type AppContainer, withOrg } from '../container.js'
import { type CredentialSource, type Resolved, resolveChat } from '../integrations/resolve.js'
import { SessionService } from '../modules/auth/SessionService.js'
import { AiReviewService } from '../modules/reviews/AiReviewService.js'
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
 * It is also the deployment's only clock, so two things that need one ride it:
 * the expired sessions are swept, and the AI reviews still in flight are polled.
 * Both are per org and both are capped the same way, and both are isolated from
 * the nudges — neither can fail a pass that has already sent something.
 *
 * It WALKS THE ORGS, one pass each, with the batch cap applied per tenancy. This
 * is the one caller in the tree that is not inside an org to begin with — a cron
 * trigger carries no credential — so it is also the one place `forOrg` is called
 * from anything but the authentication middleware. The alternative, a `listDue`
 * that reached across every tenancy, would be the single read that could return
 * another org's rows, on the one path with nobody to refuse it.
 *
 * It walks them TWICE, and the order is the point: every org's nudges go out
 * before any org's passengers run. Interleaved — one org's whole pass, then the
 * next org's — the first tenancy's passengers sit in front of the second
 * tenancy's reminders, and the AI-review poll is a batch of outbound calls to a
 * cat-factory instance that org configured and nobody else can vouch for. One
 * slow instance would spend the invocation's whole budget and the orgs behind it
 * would send nothing at all, every tick, for as long as it stayed slow. The
 * nudges are the thing with a deadline; the passengers are what the pass does
 * with what is left.
 *
 * Each walk is BOUNDED-CONCURRENT rather than serial, and the two walks are
 * still ordered one after the other. Serially, an idle org still cost three
 * store round trips before the next one was looked at and a due nudge cost
 * about seven plus an outbound post, none of them overlapping: on D1, where
 * every statement is a network hop, a single tenancy's batch could take longer
 * than the interval that started it, and a Node tick that overruns its interval
 * is skipped — which delays the reminders that caused it, which is positive
 * feedback. Nothing in a pass depends on another pass, so the only thing the
 * serial walk bought was latency.
 */
const DEFAULT_BATCH = 50

/**
 * How many orgs are in flight in one walk, and how many nudges inside one org.
 *
 * Small on purpose. The point is to hide latency, not to spend the store's
 * connection pool or Slack's rate limit: a handful of overlapping round trips
 * turns a tenancy's batch from seconds into a fraction of one, and going wider
 * buys progressively less while making the tick the noisiest client the
 * deployment has. Both are ceilings rather than targets — a pass with one due
 * nudge starts one worker.
 */
const ORG_FAN_OUT = 4
const NUDGE_FAN_OUT = 4

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
  /**
   * In-flight AI reviews polled on the way past.
   *
   * On this clock for the reason the session sweep is, and for one more: unlike
   * the sweep, this one IS about correctness. cat-factory calls nothing back, so
   * a delegated review that parks with its findings is waiting on a person
   * nothing has told. Polled on the read alone, it stays parked until somebody
   * opens the row it is on — which is to say, until somebody already suspected.
   */
  aiReviewsPolled: number
}

/** What one org's nudges did. The half of a pass that has a deadline. */
type Nudges = Pick<TickResult, 'sent' | 'failed' | 'skipped'>

/** What one delivery did, which is the counter it adds to. */
type Outcome = keyof Nudges

/** What one org's passengers did. The half that rides whatever budget is left. */
type Passengers = Pick<TickResult, 'sessionsSwept' | 'aiReviewsPolled'>

/** One tenancy's pass, filled in over the two walks. */
interface OrgPass {
  readonly container: AppContainer
  nudges: Nudges
  passengers: Passengers
}

export async function runReminderTick(
  container: AppContainer,
  batchSize: number = DEFAULT_BATCH,
): Promise<TickResult> {
  const passes: OrgPass[] = (await tenancies(container)).map((orgId) => ({
    container: withOrg(container, orgId),
    nudges: { sent: 0, failed: 0, skipped: 0 },
    passengers: { sessionsSwept: 0, aiReviewsPolled: 0 },
  }))
  // FIRST every org's nudges, because they are the half with a deadline.
  await mapWithConcurrency(passes, ORG_FAN_OUT, async (pass) => {
    pass.nudges = await sendDue(pass.container, batchSize)
  })
  // THEN every org's passengers, on whatever budget the pass has left.
  await mapWithConcurrency(passes, ORG_FAN_OUT, async (pass) => {
    pass.passengers = await ridePassengers(pass.container, batchSize)
  })
  return passes.reduce(added, empty())
}

function empty(): TickResult {
  return { sent: 0, failed: 0, skipped: 0, sessionsSwept: 0, aiReviewsPolled: 0 }
}

/**
 * One org's two halves, added into the running total and logged on the way past.
 *
 * Spelled out field by field rather than looped over the keys: a `TickResult`
 * that grew a field which is not a count would be added up as one anyway, and
 * silently.
 */
function added(total: TickResult, pass: OrgPass): TickResult {
  const result: TickResult = { ...pass.nudges, ...pass.passengers }
  report(pass.container, result)
  return {
    sent: total.sent + result.sent,
    failed: total.failed + result.failed,
    skipped: total.skipped + result.skipped,
    sessionsSwept: total.sessionsSwept + result.sessionsSwept,
    aiReviewsPolled: total.aiReviewsPolled + result.aiReviewsPolled,
  }
}

/**
 * One line per org that did something. A tick over a deployment of forty
 * tenancies is forty lines otherwise, thirty-nine of which say nothing happened.
 */
function report(container: AppContainer, result: TickResult): void {
  if (Object.values(result).some((count) => count > 0)) {
    container.logger.info({ ...result, org: container.orgId }, 'reminder tick complete')
  }
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

/** One org's nudges. `container` is already bound to it. */
async function sendDue(container: AppContainer, batchSize: number): Promise<Nudges> {
  const due = await container.repositories.reminders.listDue(container.clock.now(), batchSize)
  const nudges: Nudges = { sent: 0, failed: 0, skipped: 0 }
  // Resolved ONCE for the batch, and once PER ORG: every reminder in this pass
  // goes out over this tenancy's own credential, and resolving per reminder
  // means re-reading the stored bot token, re-deriving its HKDF key and opening
  // the envelope again for each one, on a runtime billed by CPU time.
  const chat = due.length === 0 ? null : await resolveChat(container)
  const lanes = await mapWithConcurrency(lanesOf(due), NUDGE_FAN_OUT, async (lane) => {
    const outcomes: Outcome[] = []
    for (const reminder of lane) outcomes.push(await deliver(container, reminder, chat))
    return outcomes
  })
  for (const outcome of lanes.flat()) nudges[outcome] += 1
  return nudges
}

/**
 * The batch split into lanes that may run at the same time: one lane per REVIEW,
 * in the order the batch came back.
 *
 * Per review rather than per reminder, because sending is not the end of a
 * delivery — it re-plans that review's ladder, and a re-plan cancels the
 * outstanding schedule and writes the next rung. Two deliveries for one review
 * overlapping would interleave a cancel with a create and could leave the review
 * with two scheduled nudges, or none. The schedule holds one outstanding row per
 * review, so this is normally one reminder per lane and the grouping costs
 * nothing; it is what makes the fan-out safe when it is not.
 */
function lanesOf(due: readonly Reminder[]): Reminder[][] {
  const lanes = new Map<string, Reminder[]>()
  for (const reminder of due) {
    const lane = lanes.get(reminder.reviewId)
    if (lane === undefined) lanes.set(reminder.reviewId, [reminder])
    else lane.push(reminder)
  }
  return [...lanes.values()]
}

/** One org's passengers, run once every org's nudges have gone out. */
async function ridePassengers(container: AppContainer, batchSize: number): Promise<Passengers> {
  return {
    sessionsSwept: await sweepSessions(container),
    aiReviewsPolled: await pollAiReviews(container, batchSize),
  }
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

/**
 * Ask cat-factory where this org's delegated reviews got to.
 *
 * The same batch cap as the nudges, for the same reason: every poll is an
 * outbound call, and a tenancy with two hundred runs in flight would otherwise
 * spend one tick's whole budget here. The LEAST RECENTLY POLLED are read first,
 * so what the cap leaves over is picked up next tick rather than starved — see
 * `AiReviewRunRepository.listInFlight`, where that ordering is the difference
 * between a cap and a queue nothing ever leaves.
 *
 * A sweep that fails does NOT fail the tick, exactly as the session sweep does
 * not: the reminders in this pass have already gone out, and a cat-factory that
 * is unreachable for a minute is not a reason to re-send every nudge next
 * minute. A poll that is merely refused never reaches here — the service records
 * that on the run, where the board shows it.
 */
async function pollAiReviews(container: AppContainer, batchSize: number): Promise<number> {
  try {
    return await new AiReviewService(container).sweepInFlight(batchSize)
  } catch (err) {
    container.logger.warn({ err }, 'could not poll the AI reviews in flight')
    return 0
  }
}

/**
 * One nudge, from the row to the post, and the only place a reminder is sent.
 *
 * It CLAIMS the row before it posts anything, and skips what it could not
 * claim. `listDue` is a read: two passes over the same batch both see the same
 * fifty rows, and two passes is not hypothetical — a deployment running two
 * Node replicas has two clocks, and the Worker's cron can fire while the last
 * invocation is still inside `waitUntil`. The claim is one conditional
 * statement, so exactly one of them wins and nobody is nudged twice. It comes
 * FIRST, before the review and the target are read, so a pass that lost the race
 * spends one statement rather than three.
 *
 * What it does not buy is exactly-once. A process that dies between the claim
 * and the mark leaves a row in `sending` and that nudge is not re-sent — which
 * is the trade this makes deliberately: a reminder that arrives twice is worse
 * than one that arrives late, and the review's next re-plan puts the ladder back
 * on its feet.
 */
async function deliver(
  container: AppContainer,
  reminder: Reminder,
  chat: Resolved<ChatGateway, CredentialSource> | null,
): Promise<Outcome> {
  if (!(await container.repositories.reminders.claim(reminder))) return 'skipped'
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

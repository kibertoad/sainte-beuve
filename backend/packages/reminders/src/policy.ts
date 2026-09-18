import type {
  AiReviewRun,
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
  /** The snooze this nudge is still holding for. See {@link deferred}. */
  snoozedUntil: EpochMs | null
}

/**
 * One rung's answer, before the snooze is applied to it.
 *
 * The rungs compete on the time the CADENCE puts them at, and the deferral is
 * then applied to whichever of them won. A snooze that had moved each candidate
 * before they were compared would decide the ladder by which rung happened to be
 * furthest out, which is the opposite of what a pause means.
 */
type Candidate = Omit<PlannedReminder, 'snoozedUntil'>

/**
 * What the ladder has to know about a review that is not ON the review.
 *
 * One field today, and an interface rather than that field because of what the
 * field is: a signal is something the review is WAITING ON that lives in another
 * table, and the next one (a merge conflict, a failing check) is the same shape.
 * A caller that has none says so explicitly, which is the point — a positional
 * `null` that means "no AI review parked" and a forgotten argument that means
 * "I did not look" are the same call, and the second one is silence.
 */
export interface ReviewSignals {
  /**
   * When the review's delegated AI review last parked on its findings, or null
   * when none of them is parked. See `parkedSince`.
   */
  aiReviewParkedAt: EpochMs | null
}

/**
 * When a review's AI runs last parked, out of all the runs it has.
 *
 * The LATEST park rather than the earliest, because a nudge is about a park
 * rather than about a run: one that has already gone out covers every run parked
 * before it, and a run that parks afterwards is a new thing to say. Taking the
 * earliest instead would leave a review whose second run parked yesterday silent
 * behind a first that was already announced.
 */
export function parkedSince(runs: readonly AiReviewRun[]): EpochMs | null {
  let parked: EpochMs | null = null
  for (const run of runs) {
    if (run.status !== 'awaiting_selection' || run.parkedAt === null) continue
    if (parked === null || run.parkedAt > parked) parked = run.parkedAt
  }
  return parked
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
): Candidate | null {
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
 * Who hears a nudge about this review: the assigned reviewer privately, or the
 * channel while nobody owns it.
 *
 * One rule, used by every kind that is not the escalation, because the audience
 * is a property of the REVIEW rather than of what the nudge is about. A parked
 * AI review that went to the channel for an assigned review would widen the
 * audience as a side effect of pressing a button, and the escalation is the only
 * thing allowed to do that.
 */
function audienceFor(review: ReviewRequest): Pick<Candidate, 'channel' | 'reviewerId'> {
  const [reviewerId] = review.assignedReviewerIds
  return reviewerId === undefined
    ? { channel: 'slack_channel', reviewerId: null }
    : { channel: 'slack_dm', reviewerId }
}

/**
 * The ordinary nudge: the channel while nobody owns the review, the assigned
 * reviewer's DM once somebody does, up to the pending budget.
 */
function planNudge(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
): Candidate | null {
  if (review.assignedReviewerIds.length === 0) {
    if (latestSentAt(alreadySent, 'unassigned') !== null) return null
    return {
      reviewId: review.id,
      kind: 'unassigned',
      ...audienceFor(review),
      dueAt: nextUnassignedReminderAt(review, policy),
    }
  }

  if (sentPendingCount(alreadySent) >= policy.maxPendingReminders) return null
  return {
    reviewId: review.id,
    kind: 'pending',
    ...audienceFor(review),
    dueAt: nextPendingReminderAt(review, policy, latestSentAt(alreadySent, 'pending')),
  }
}

/**
 * The nudge that says a delegated review has parked on its findings and is
 * waiting to be curated.
 *
 * Planned ONCE PER PARK, which is what the timestamp comparison is for rather
 * than a budget like the pending one's. The other kinds are about a silence that
 * goes on, so repeating them means chasing harder; this one is about an EVENT,
 * and a second nudge about the same park says nothing the first did not. A post
 * that fails re-parks the review with a receipt to read, and that is a new park
 * with a new timestamp, so it is announced again — which is the case a budget
 * would have got wrong in the direction that loses work.
 *
 * It is not gated on the pending budget and does not spend it. A review whose
 * reviewer has stopped answering is exactly the one somebody delegated to
 * cat-factory, and going quiet about the findings because the human ladder is
 * spent would silence the half that still has something new to report.
 */
function planAiReviewParked(
  review: ReviewRequest,
  policy: ReminderPolicy,
  alreadySent: readonly Reminder[],
  parkedAt: EpochMs | null,
): Candidate | null {
  if (parkedAt === null) return null
  const announced = latestSentAt(alreadySent, 'ai_review_parked')
  if (announced !== null && announced >= parkedAt) return null
  return {
    reviewId: review.id,
    kind: 'ai_review_parked',
    ...audienceFor(review),
    dueAt: parkedAt + policy.aiReviewParkedAfterMs * cadenceMultiplier(review),
  }
}

/**
 * The soonest candidate, or null when there is none. A tie goes to the first in
 * the list, and the list is ordered by how much a nudge has to say: the
 * escalation, which widens the audience; then the parked AI review, which
 * reports something that has happened; then the ordinary nudge, which repeats
 * that a review is still waiting. Whichever loses a tie is re-planned behind the
 * one that won rather than lost, because the tick re-plans after every send.
 */
function earliest(candidates: readonly (Candidate | null)[]): Candidate | null {
  let soonest: Candidate | null = null
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
 * A resolved review plans nothing, INCLUDING a parked AI review: the findings
 * are still there to curate, and the board still says so, but a pull request
 * that has been approved or closed is not something to interrupt anybody about.
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
  signals: ReviewSignals,
): PlannedReminder | null {
  if (isResolved(review)) return null
  const planned = earliest([
    planEscalation(review, policy, alreadySent),
    planAiReviewParked(review, policy, alreadySent, signals.aiReviewParkedAt),
    planNudge(review, policy, alreadySent),
  ])
  return planned === null ? null : deferred(planned, snoozedUntil(alreadySent))
}

/**
 * How long a snooze is still holding this review's ladder back, read off the
 * OUTSTANDING row.
 *
 * Off the row rather than passed in, because that is where a snooze already
 * lives: `snoozeReview` records it on the single scheduled nudge it writes, and
 * every re-plan reads this list before it cancels that row. A nudge that has been
 * sent, cancelled or failed carries no deferral — the pause it asked for is over,
 * because the thing it was holding back has happened.
 */
function snoozedUntil(alreadySent: readonly Reminder[]): EpochMs | null {
  return alreadySent.find((r) => r.status === 'scheduled')?.snoozedUntil ?? null
}

/**
 * The winning rung, pushed out by a snooze that is still holding it.
 *
 * Deferring the LADDER rather than one row is the only reading that survives what
 * a re-plan does. The outstanding schedule is rewritten from scratch whenever
 * anything moves — a status write, a nudge going out, a poll that found a
 * delegated review parked — so a pause that was only a later `dueAt` on one row
 * would be undone by the next of those and the nudge would go out at a time that
 * is already in the past. It also crosses KINDS on purpose: somebody asking for a
 * few hours' quiet about a review is not asking to be told about it on a
 * different rung instead.
 *
 * It stops travelling the moment the rung would come due after it anyway. At that
 * point the pause has expired, and a timestamp copied onto every row after it
 * would outlive the thing it described.
 */
function deferred(candidate: Candidate, until: EpochMs | null): PlannedReminder {
  if (until === null || until <= candidate.dueAt) return { ...candidate, snoozedUntil: null }
  return { ...candidate, dueAt: until, snoozedUntil: until }
}

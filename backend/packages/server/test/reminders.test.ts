import type { Reminder, Reviewer, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import type { ChatGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiReviewService } from '../src/modules/reviews/AiReviewService.js'
import { snoozeReview } from '../src/reminders/snooze.js'
import { type AppContainer, withOrg } from '../src/container.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { curation, type StubAiReview, stubAiReview } from './ai-review-doubles.js'
import {
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  get,
  openReview,
  patch,
  post,
  PR,
} from './helpers.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A chat gateway that records deliveries instead of making them. */
function recordingChat(): ChatGateway & { delivered: { kind: string; target: string }[] } {
  const delivered: { kind: string; target: string }[] = []
  return {
    delivered,
    announceReview: async () => ({ messageId: 'm-1' }),
    sendReminder: async (reminder, _review, target) => {
      delivered.push({ kind: reminder.kind, target })
    },
  }
}

function scheduled(reminders: Reminder[]): Reminder[] {
  return reminders.filter((r) => r.status === 'scheduled')
}

async function remindersFor(harness: TestHarness, reviewId: string): Promise<Reminder[]> {
  return harness.container.repositories.reminders.listByReview(reviewId)
}

/** A review with one reviewer on it, which is where the pending ladder starts. */
async function assignedReview(
  harness: TestHarness,
): Promise<{ review: ReviewRequest; reviewer: Reviewer }> {
  const reviewer = await addReviewer(harness, {
    displayName: 'Peer',
    handles: { github: 'peer' },
    slackUserId: 'U123',
  })
  const review = await openReview(harness)
  await assignReviewer(harness, review.id)
  return { review, reviewer }
}

describe('reminder tick', () => {
  let harness: TestHarness
  let chat: ReturnType<typeof recordingChat>

  beforeEach(() => {
    chat = recordingChat()
    harness = buildHarness({
      chat,
      slack: { signingSecret: null, announcementChannelId: 'C-reviews' },
    })
  })

  it('chases an unclaimed review in the channel once its wait is up', async () => {
    const review = await openReview(harness)
    expect(await runReminderTick(harness.container)).toStrictEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      sessionsSwept: 0,
      aiReviewsPolled: 0,
    })

    harness.clock.advance(4 * HOUR)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([{ kind: 'unassigned', target: 'C-reviews' }])
    expect(scheduled(await remindersFor(harness, review.id))).toStrictEqual([])
  })

  it('sends a due nudge once even when two passes run over the same batch', async () => {
    // The shape a horizontally scaled deployment is in: two Node replicas have
    // two clocks, and the Worker's cron can fire while the last invocation is
    // still inside `waitUntil`. Both passes read the same due row — `listDue`
    // is a read — and only the one that CLAIMS it posts.
    await assignedReview(harness)
    harness.clock.advance(DAY)

    const [first, second] = await Promise.all([
      runReminderTick(harness.container),
      runReminderTick(harness.container),
    ])

    expect(chat.delivered).toHaveLength(1)
    expect(first.sent + second.sent).toBe(1)
    // The pass that lost the race says so rather than reporting a failure: a
    // nudge somebody else is sending is not a fault to record on the row.
    expect(first.failed + second.failed).toBe(0)
    expect(first.skipped + second.skipped).toBe(1)
  })

  it('plans the next nudge after sending one, up to the pending budget', async () => {
    const { review } = await assignedReview(harness)

    for (let nudge = 1; nudge <= harness.container.reminderPolicy.maxPendingReminders; nudge++) {
      harness.clock.advance(DAY)
      expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
      expect(chat.delivered).toHaveLength(nudge)
    }
    // The budget is spent and the review has no deadline, so the ladder ends here
    // rather than going on for ever.
    expect(scheduled(await remindersFor(harness, review.id))).toStrictEqual([])

    harness.clock.advance(DAY)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 0 })
    expect(chat.delivered.map((d) => d.kind)).toStrictEqual(['pending', 'pending', 'pending'])
    expect(chat.delivered.every((d) => d.target === 'U123')).toBe(true)
  })

  it('widens the audience once the deadline has passed', async () => {
    const now = harness.clock.now()
    const reviewer = await addReviewer(harness, {
      displayName: 'Peer',
      handles: { github: 'peer' },
      slackUserId: 'U123',
    })
    const review = await openReview(harness, { dueAt: now + 2 * DAY })
    await assignReviewer(harness, review.id)
    expect(reviewer.id).toBeTruthy()

    // The DM is due first, a day in; the escalation only a day past the deadline.
    harness.clock.advance(DAY)
    await runReminderTick(harness.container)
    expect(chat.delivered.map((d) => d.kind)).toStrictEqual(['pending'])

    harness.clock.advance(2 * DAY)
    await runReminderTick(harness.container)
    // A tick sends the batch it read, so what that send plans goes out on the next
    // one rather than turning one tick into a drumbeat.
    await runReminderTick(harness.container)
    expect(chat.delivered.map((d) => d.kind)).toStrictEqual(['pending', 'pending', 'escalation'])
    expect(chat.delivered.at(-1)?.target).toBe('C-reviews')
  })

  it('records why a nudge could not be delivered instead of dropping it', async () => {
    const unwired = buildHarness()
    const review = await openReview(unwired)
    unwired.clock.advance(4 * HOUR)

    expect(await runReminderTick(unwired.container)).toMatchObject({ failed: 1, skipped: 0 })
    const [reminder] = await remindersFor(unwired, review.id)
    expect(reminder?.status).toBe('failed')
    expect(reminder?.failureReason).toBe('chat is not configured for this deployment')
  })

  it('says which reviewer could not be reached when a DM has no address', async () => {
    await addReviewer(harness, { displayName: 'Peer', handles: { github: 'peer' } })
    const review = await openReview(harness)
    await assignReviewer(harness, review.id)

    harness.clock.advance(DAY)
    expect(await runReminderTick(harness.container)).toMatchObject({ failed: 1 })
    const failed = (await remindersFor(harness, review.id)).filter((r) => r.status === 'failed')
    expect(failed.map((r) => r.failureReason)).toStrictEqual([
      'the assigned reviewer has no Slack user id',
    ])
  })

  it('keeps a snoozed nudge private when the ladder had nothing outstanding', async () => {
    // The ladder can be between rungs: the last nudge went out and the policy
    // planned nothing behind it. A snooze then has to invent the target, and
    // inventing a CHANNEL post for an assigned review would widen the audience
    // as a reward for asking for time.
    const { review, reviewer } = await assignedReview(harness)
    await harness.container.repositories.reminders.cancelScheduledForReview(review.id)
    // Re-read, because the assignment is what the snooze has to see: this is the
    // row the Slack command resolves before it defers anything.
    const assigned = await harness.container.repositories.reviews.getById(review.id)

    const snoozed = await snoozeReview(harness.container, assigned!, 2)
    expect(snoozed).toMatchObject({
      kind: 'pending',
      channel: 'slack_dm',
      reviewerId: reviewer.id,
    })

    harness.clock.advance(2 * HOUR)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([{ kind: 'pending', target: 'U123' }])
  })

  it('stops chasing a review that has been answered', async () => {
    const { review } = await assignedReview(harness)
    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'approved' }))

    harness.clock.advance(7 * DAY)
    expect(await runReminderTick(harness.container)).toStrictEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      sessionsSwept: 0,
      aiReviewsPolled: 0,
    })
    expect(chat.delivered).toStrictEqual([])
    const statuses = (await remindersFor(harness, review.id)).map((r) => r.status)
    expect(new Set(statuses)).toStrictEqual(new Set(['cancelled']))
  })
})

/**
 * The nudge that says a delegated review has parked on its findings.
 *
 * The half of the loop the clock could see and nobody else could: the sweep
 * already learnt that a review parked, and until this rung existed that
 * knowledge stayed inside the process — the row said `awaiting_selection` to
 * whoever opened it, which is the person who would have opened it anyway.
 *
 * Driven through the tick rather than through the policy, because the policy's
 * own suite has the ladder: what these cases are about is the poll WRITING the
 * park and the schedule following it, which only exists once a store, a clock
 * and a cat-factory are in the same pass.
 */
describe('a parked AI review', () => {
  let harness: TestHarness
  let chat: ReturnType<typeof recordingChat>
  let catFactory: StubAiReview

  beforeEach(() => {
    chat = recordingChat()
    catFactory = stubAiReview()
    harness = buildHarness({
      chat,
      aiReview: catFactory,
      slack: { signingSecret: null, announcementChannelId: 'C-reviews' },
    })
  })

  /** A review handed to cat-factory, with the reviewer parked on its findings. */
  async function parked(): Promise<ReviewRequest> {
    const review = await openReview(harness)
    expect(
      (await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))).status,
    ).toBe(202)
    catFactory.report = { ...catFactory.report, status: 'awaiting_selection', curation: curation() }
    return review
  }

  /** The nudge the ladder is holding for a review, if it is holding one. */
  async function outstanding(reviewId: string): Promise<Reminder | undefined> {
    return scheduled(await remindersFor(harness, reviewId))[0]
  }

  it('is announced once the clock finds it, on the wait the policy names', async () => {
    const review = await parked()

    // The tick that discovers the park schedules the nudge; it does not send it
    // out under the person who pressed the button a moment ago.
    expect(await runReminderTick(harness.container)).toMatchObject({ aiReviewsPolled: 1, sent: 0 })
    expect(await outstanding(review.id)).toMatchObject({ kind: 'ai_review_parked' })

    harness.clock.advance(harness.container.reminderPolicy.aiReviewParkedAfterMs)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([{ kind: 'ai_review_parked', target: 'C-reviews' }])
  })

  it('is announced once per park, and again when a post re-parks the review', async () => {
    const review = await parked()
    const wait = harness.container.reminderPolicy.aiReviewParkedAfterMs
    await runReminderTick(harness.container)
    harness.clock.advance(wait)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    // A park is announced ONCE: a second nudge about the same one says nothing
    // the first did not, and the review may sit parked for days. What the tick
    // keeps doing is polling it, which is how the re-park below is ever found.
    harness.clock.advance(wait)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 0, aiReviewsPolled: 1 })
    expect(chat.delivered).toHaveLength(1)

    // A post that fails re-parks the review, with a receipt on it saying what
    // did not land. That is a new thing to say rather than a repeat of the first.
    catFactory.report = { ...catFactory.report, status: 'running', curation: null }
    await harness.app.fetch(get(`/api/v1/reviews/${review.id}/ai-review`))
    catFactory.report = { ...catFactory.report, status: 'awaiting_selection', curation: curation() }
    await runReminderTick(harness.container)

    harness.clock.advance(wait)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([
      { kind: 'ai_review_parked', target: 'C-reviews' },
      { kind: 'ai_review_parked', target: 'C-reviews' },
    ])
  })

  it('announces a re-park no poll ever saw leave', async () => {
    const review = await parked()
    const wait = harness.container.reminderPolicy.aiReviewParkedAfterMs
    await runReminderTick(harness.container)
    harness.clock.advance(wait)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })

    // Somebody read the nudge, posted, and the post failed. `resolve` answers 202
    // and cat-factory acts asynchronously, so that pass starts and fails between
    // two polls and never shows up on the row as anything but `awaiting_selection`.
    // The STATUS therefore cannot tell this park from the one already announced;
    // `postAttempts` can, because it only ever goes up.
    harness.clock.advance(wait)
    catFactory.report = {
      ...catFactory.report,
      curation: curation({ postAttempts: 1, postedBody: false }),
    }
    await runReminderTick(harness.container)
    expect(await outstanding(review.id)).toMatchObject({ kind: 'ai_review_parked' })

    harness.clock.advance(wait)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([
      { kind: 'ai_review_parked', target: 'C-reviews' },
      { kind: 'ai_review_parked', target: 'C-reviews' },
    ])
  })

  it('schedules one nudge when two runs on a review park in the same read', async () => {
    const review = await openReview(harness)
    for (const _ of [1, 2]) {
      expect(
        (await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))).status,
      ).toBe(202)
    }
    catFactory.report = { ...catFactory.report, status: 'awaiting_selection', curation: curation() }

    // Both runs park on the one read, and the ladder is a single row rewritten by
    // a cancel-then-create: re-planned once per run, the two passes cancel the
    // same nothing and write two scheduled rows, so the nudge goes out twice and
    // a snooze afterwards would only move one of them.
    await harness.app.fetch(get(`/api/v1/reviews/${review.id}/ai-review`))

    expect(scheduled(await remindersFor(harness, review.id))).toHaveLength(1)
    harness.clock.advance(harness.container.reminderPolicy.aiReviewParkedAfterMs)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toHaveLength(1)
  })

  it('holds a snooze that the re-plan would otherwise undo', async () => {
    const review = await parked()
    // Somebody asked for a few hours' quiet about this review.
    const snoozed = await snoozeReview(harness.container, review, 3)
    expect(snoozed.snoozedUntil).toBe(snoozed.dueAt)

    // The clock then finds the park and re-plans the ladder, which is a pass the
    // person who deferred it never sees. Re-planned from the cadence alone, the
    // nudge comes due fifteen minutes after the park — hours before the quiet they
    // asked for is up, and on a row they have no reason to look at again.
    await runReminderTick(harness.container)
    expect(await outstanding(review.id)).toMatchObject({
      kind: 'ai_review_parked',
      dueAt: snoozed.dueAt,
      snoozedUntil: snoozed.dueAt,
    })

    harness.clock.advance(harness.container.reminderPolicy.aiReviewParkedAfterMs)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 0 })
    expect(chat.delivered).toStrictEqual([])

    // Still chased, later, which is what a snooze means.
    harness.clock.advance(3 * HOUR)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 1 })
    expect(chat.delivered).toStrictEqual([{ kind: 'ai_review_parked', target: 'C-reviews' }])
  })

  it('leaves the park to be found again when the ladder cannot be written', async () => {
    const review = await parked()
    const { repositories } = harness.container
    const brokenLadder: AppContainer = {
      ...harness.container,
      repositories: {
        ...repositories,
        reminders: {
          ...repositories.reminders,
          cancelScheduledForReview: async () => {
            throw new Error('the reminder store is down')
          },
        },
      },
    }

    await new AiReviewService(brokenLadder).listByReview(review.id)

    // Not recorded on the run as a cat-factory fault: the re-plan sits outside the
    // poll's own try/catch, and a receipt naming the wrong system is what sent
    // somebody to check an instance that was answering fine.
    const [run] = await repositories.aiReviewRuns.listByReview(review.id)
    expect(run?.failureReason).toBeNull()
    // And the stamp is back where it was, because it is the only thing that tells
    // a later poll the park is news. Left standing, this park would never be
    // announced at all — there would be no edge left to find.
    expect(run?.parkedAt).toBeNull()
    expect(await outstanding(review.id)).toMatchObject({ kind: 'unassigned' })

    // Which the next poll, against a store that can write, duly finds.
    await runReminderTick(harness.container)
    expect(await outstanding(review.id)).toMatchObject({ kind: 'ai_review_parked' })
  })

  it('goes off the schedule when the review is curated before the nudge fires', async () => {
    const review = await parked()
    await runReminderTick(harness.container)
    expect(await outstanding(review.id)).toMatchObject({ kind: 'ai_review_parked' })

    // Somebody opened the row and finished the review. The read that learns it
    // is the read that takes the nudge off, on the same poll that wrote the park.
    catFactory.report = { ...catFactory.report, status: 'completed', curation: null }
    await harness.app.fetch(get(`/api/v1/reviews/${review.id}/ai-review`))

    harness.clock.advance(harness.container.reminderPolicy.aiReviewParkedAfterMs)
    expect(await runReminderTick(harness.container)).toMatchObject({ sent: 0 })
    expect(chat.delivered).toStrictEqual([])
    expect(await outstanding(review.id)).toMatchObject({ kind: 'unassigned' })
  })
})

/**
 * The order the two halves of a pass run in, across tenancies.
 *
 * A nudge has a deadline and a passenger does not, and the passengers are the
 * outbound half: the AI-review poll is a batch of calls to a cat-factory instance
 * one org configured and nobody else can vouch for. Walked one whole org at a
 * time, that org's poll sits in front of every later org's reminders, so a single
 * slow instance spends the invocation and the tenancies behind it send nothing —
 * every tick, for as long as it stays slow.
 */
describe('a tick across tenancies', () => {
  const OTHER_ORG = 'org-second'

  /** One org with a nudge due and one AI review in flight. */
  async function seed(harness: TestHarness, orgId: string, n: number): Promise<void> {
    const { repositories, clock } = withOrg(harness.container, orgId)
    const review = await repositories.reviews.create({
      id: `review-${orgId}`,
      pullRequest: { ...PR, number: n, url: `https://example.com/pull/${n}` },
      title: 'A change',
      authorLogin: 'author',
      requiredSkills: [],
      priority: 'normal',
      status: 'open',
      assignedReviewerIds: [],
      createdAt: clock.now(),
      updatedAt: clock.now(),
      assignedAt: null,
      dueAt: null,
    })
    await repositories.reminders.create({
      id: `reminder-${orgId}`,
      reviewId: review.id,
      kind: 'unassigned',
      channel: 'slack_channel',
      reviewerId: null,
      dueAt: clock.now(),
      snoozedUntil: null,
      status: 'scheduled',
      sentAt: null,
      failureReason: null,
      createdAt: clock.now(),
    })
    await repositories.aiReviewRuns.create({
      id: `run-${orgId}`,
      reviewId: review.id,
      status: 'running',
      catFactoryTaskId: `cf-task-${orgId}`,
      catFactoryRunId: 'cf-run-1',
      catFactoryUrl: null,
      summary: null,
      failureReason: null,
      curation: null,
      requestedAt: clock.now(),
      lastPolledAt: null,
      parkedAt: null,
      completedAt: null,
    })
  }

  it('sends every org its nudges before any org polls cat-factory', async () => {
    const order: string[] = []
    const catFactory = stubAiReview()
    catFactory.onPoll = async () => {
      order.push('poll')
    }
    const harness = buildHarness({
      aiReview: catFactory,
      chat: {
        announceReview: async () => ({ messageId: 'm-1' }),
        sendReminder: async () => {
          order.push('nudge')
        },
      },
      slack: { signingSecret: null, announcementChannelId: 'C-reviews' },
    })
    await harness.container.stores.orgs.create({
      id: OTHER_ORG,
      slug: 'second',
      name: 'Second',
      createdAt: harness.clock.now(),
    })
    await seed(harness, DEFAULT_ORG_ID, 11)
    await seed(harness, OTHER_ORG, 12)

    const result = await runReminderTick(harness.container)

    expect(result).toMatchObject({ sent: 2, aiReviewsPolled: 2 })
    // Not ['nudge', 'poll', 'nudge', 'poll'], which is what one walk gives.
    expect(order).toStrictEqual(['nudge', 'nudge', 'poll', 'poll'])
  })
})

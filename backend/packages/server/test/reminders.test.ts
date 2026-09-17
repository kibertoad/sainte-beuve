import type { Reminder, Reviewer, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import type { ChatGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { snoozeReview } from '../src/reminders/snooze.js'
import { withOrg } from '../src/container.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { stubAiReview } from './ai-review-doubles.js'
import {
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  openReview,
  patch,
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

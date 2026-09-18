import type { AiReviewRun, Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_REMINDER_POLICY } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  cadenceMultiplier,
  isResolved,
  parkedSince,
  planNextReminder,
  type ReviewSignals,
} from './policy.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function review(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: 'rev-1',
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 1,
      url: 'https://github.com/kibertoad/sainte-beuve/pull/1',
    },
    title: 'Add a health check',
    authorLogin: 'author',
    requiredSkills: [],
    priority: 'normal',
    status: 'open',
    assignedReviewerIds: [],
    createdAt: 0,
    updatedAt: 0,
    assignedAt: null,
    dueAt: null,
    ...overrides,
  }
}

/** A run parked on its findings, with only what a case cares about spelled out. */
function parkedRun(overrides: Partial<AiReviewRun> = {}): AiReviewRun {
  return {
    id: 'run-1',
    reviewId: 'rev-1',
    status: 'awaiting_selection',
    catFactoryTaskId: 'cf-task-1',
    catFactoryRunId: 'cf-run-1',
    catFactoryUrl: null,
    summary: null,
    failureReason: null,
    curation: null,
    requestedAt: 0,
    lastPolledAt: null,
    parkedAt: DAY,
    completedAt: null,
    ...overrides,
  }
}

function sentReminder(overrides: Partial<Reminder> & { kind: Reminder['kind'] }): Reminder {
  return {
    id: 'rem-1',
    reviewId: 'rev-1',
    channel: 'slack_dm',
    reviewerId: null,
    dueAt: 0,
    snoozedUntil: null,
    status: 'sent',
    sentAt: 0,
    failureReason: null,
    createdAt: 0,
    ...overrides,
  }
}

describe('isResolved', () => {
  it('stops the clock once a review has a verdict', () => {
    expect(isResolved(review({ status: 'approved' }))).toBe(true)
    expect(isResolved(review({ status: 'changes_requested' }))).toBe(true)
    expect(isResolved(review({ status: 'closed' }))).toBe(true)
    expect(isResolved(review({ status: 'in_review' }))).toBe(false)
  })
})

describe('cadenceMultiplier', () => {
  it('halves the wait for high priority and doubles it for low', () => {
    expect(cadenceMultiplier(review({ priority: 'high' }))).toBe(0.5)
    expect(cadenceMultiplier(review({ priority: 'normal' }))).toBe(1)
    expect(cadenceMultiplier(review({ priority: 'low' }))).toBe(2)
  })
})

describe('parkedSince', () => {
  it('answers with the latest park, so a second one is not hidden behind the first', () => {
    const runs = [
      parkedRun({ id: 'run-1', parkedAt: DAY }),
      parkedRun({ id: 'run-2', parkedAt: 2 * DAY }),
    ]
    expect(parkedSince(runs)).toBe(2 * DAY)
  })

  it('ignores a run that is no longer parked', () => {
    expect(parkedSince([parkedRun({ status: 'completed', parkedAt: DAY })])).toBeNull()
    expect(parkedSince([parkedRun({ parkedAt: null })])).toBeNull()
    expect(parkedSince([])).toBeNull()
  })
})

/** A review with no AI review parked on it, which is what most cases are about. */
const NOTHING_PARKED: ReviewSignals = { aiReviewParkedAt: null }

describe('planNextReminder', () => {
  const policy = DEFAULT_REMINDER_POLICY
  /**
   * One parked an hour in, which is where every parked case below counts from.
   * Early enough that the nudge it plans is genuinely the soonest: which rung
   * wins is decided by the clock rather than by a precedence between kinds, so a
   * case about the parked rung has to put it first the way a real park does.
   */
  const PARKED: ReviewSignals = { aiReviewParkedAt: HOUR }

  it('plans nothing for a resolved review', () => {
    expect(planNextReminder(review({ status: 'approved' }), policy, [], NOTHING_PARKED)).toBeNull()
  })

  it('chases an unclaimed review in the channel', () => {
    const planned = planNextReminder(review(), policy, [], NOTHING_PARKED)
    expect(planned).toStrictEqual({
      reviewId: 'rev-1',
      kind: 'unassigned',
      channel: 'slack_channel',
      reviewerId: null,
      dueAt: 4 * HOUR,
      snoozedUntil: null,
    })
  })

  it('does not chase an unclaimed review twice', () => {
    const sent = [sentReminder({ kind: 'unassigned', channel: 'slack_channel' })]
    expect(planNextReminder(review(), policy, sent, NOTHING_PARKED)).toBeNull()
  })

  it('DMs the assigned reviewer a day after assignment', () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: HOUR }),
      policy,
      [],
      NOTHING_PARKED,
    )
    expect(planned?.kind).toBe('pending')
    expect(planned?.channel).toBe('slack_dm')
    expect(planned?.reviewerId).toBe('rvw-1')
    expect(planned?.dueAt).toBe(HOUR + DAY)
  })

  it('spaces repeat nudges from the last one sent, not from assignment', () => {
    const sent = [sentReminder({ kind: 'pending', sentAt: 5 * DAY })]
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned?.dueAt).toBe(6 * DAY)
  })

  it('goes quiet once the pending budget is spent', () => {
    const sent = Array.from({ length: policy.maxPendingReminders }, (_unused, i) =>
      sentReminder({ kind: 'pending', id: `rem-${i}`, sentAt: i * DAY }),
    )
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned).toBeNull()
  })

  it('escalates past the deadline even with the pending budget spent', () => {
    const sent = Array.from({ length: policy.maxPendingReminders }, (_unused, i) =>
      sentReminder({ kind: 'pending', id: `rem-${i}`, sentAt: i * DAY }),
    )
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 2 * DAY }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned?.kind).toBe('escalation')
    expect(planned?.channel).toBe('slack_channel')
    expect(planned?.dueAt).toBe(3 * DAY)
  })

  it('escalates only once', () => {
    const sent = [sentReminder({ kind: 'escalation', channel: 'slack_channel', sentAt: 3 * DAY })]
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 2 * DAY }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned?.kind).toBe('pending')
  })

  it('does not let a distant deadline silence the nudge that is due first', () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 7 * DAY }),
      policy,
      [],
      NOTHING_PARKED,
    )
    expect(planned?.kind).toBe('pending')
    expect(planned?.dueAt).toBe(DAY)
  })

  it('chases an unclaimed review in the channel before its deadline escalation', () => {
    const planned = planNextReminder(review({ dueAt: 7 * DAY }), policy, [], NOTHING_PARKED)
    expect(planned?.kind).toBe('unassigned')
    expect(planned?.dueAt).toBe(4 * HOUR)
  })

  it("says a parked AI review is waiting, on the assigned reviewer's own DM", () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      [],
      PARKED,
    )
    expect(planned).toStrictEqual({
      reviewId: 'rev-1',
      kind: 'ai_review_parked',
      channel: 'slack_dm',
      reviewerId: 'rvw-1',
      dueAt: HOUR + policy.aiReviewParkedAfterMs,
      snoozedUntil: null,
    })
  })

  it('tells the channel about a parked AI review on a review nobody owns', () => {
    const planned = planNextReminder(review(), policy, [], PARKED)
    expect(planned?.kind).toBe('ai_review_parked')
    expect(planned?.channel).toBe('slack_channel')
    expect(planned?.reviewerId).toBeNull()
  })

  it('announces one park once, however long it stays parked', () => {
    const sent = [sentReminder({ kind: 'ai_review_parked', sentAt: 2 * HOUR })]
    const planned = planNextReminder(review(), policy, sent, PARKED)
    expect(planned?.kind).toBe('unassigned')
  })

  it('announces a re-park, because a failed post is a new thing to say', () => {
    const sent = [sentReminder({ kind: 'ai_review_parked', sentAt: 2 * HOUR })]
    const planned = planNextReminder(review(), policy, sent, { aiReviewParkedAt: 3 * HOUR })
    expect(planned?.kind).toBe('ai_review_parked')
    expect(planned?.dueAt).toBe(3 * HOUR + policy.aiReviewParkedAfterMs)
  })

  it('reports a parked AI review even once the pending budget is spent', () => {
    const sent = Array.from({ length: policy.maxPendingReminders }, (_unused, i) =>
      sentReminder({ kind: 'pending', id: `rem-${i}`, sentAt: i * DAY }),
    )
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      sent,
      PARKED,
    )
    expect(planned?.kind).toBe('ai_review_parked')
  })

  it('leaves a review that already has a verdict alone, parked findings and all', () => {
    expect(planNextReminder(review({ status: 'approved' }), policy, [], PARKED)).toBeNull()
  })

  it('halves the wait on a high-priority review, as every other rung does', () => {
    const planned = planNextReminder(review({ priority: 'high' }), policy, [], PARKED)
    expect(planned?.dueAt).toBe(HOUR + policy.aiReviewParkedAfterMs / 2)
  })

  it('does not let a park silence an escalation that is due first', () => {
    const planned = planNextReminder(
      review({ dueAt: 0 }),
      policy,
      [sentReminder({ kind: 'unassigned', channel: 'slack_channel' })],
      { aiReviewParkedAt: 3 * DAY },
    )
    expect(planned?.kind).toBe('escalation')
  })

  it('escalates once the deadline comes round before the next nudge', () => {
    const sent = [sentReminder({ kind: 'pending', sentAt: 5 * DAY })]
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 4 * DAY }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned?.kind).toBe('escalation')
    expect(planned?.dueAt).toBe(5 * DAY)
  })
})

/**
 * A snooze defers the LADDER, not one row.
 *
 * Which only shows up here, in the pure suite, because the hazard is a re-plan:
 * the outstanding schedule is rewritten from scratch whenever anything moves, and
 * one of those things is a background poll that found a delegated AI review
 * parked. A pause that lived only in the `dueAt` of the row somebody asked for it
 * on would be undone by a pass they never saw, at a time that has already gone by.
 */
describe('a snoozed review', () => {
  const policy = DEFAULT_REMINDER_POLICY
  const PARKED: ReviewSignals = { aiReviewParkedAt: HOUR }

  /** The outstanding row a snooze leaves behind: deferred, and saying so. */
  function snoozed(until: number): Reminder {
    return sentReminder({
      kind: 'pending',
      status: 'scheduled',
      sentAt: null,
      dueAt: until,
      snoozedUntil: until,
    })
  }

  it('carries the pause onto the row the next re-plan writes', () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      [snoozed(3 * DAY)],
      NOTHING_PARKED,
    )
    // Not `pendingAfterMs` from the assignment, which is what the policy would
    // have said on its own and is a time three days in the past by now.
    expect(planned?.dueAt).toBe(3 * DAY)
    expect(planned?.snoozedUntil).toBe(3 * DAY)
  })

  it('holds a park found in the background back to the same moment', () => {
    const planned = planNextReminder(review(), policy, [snoozed(3 * DAY)], PARKED)
    // The park is still what the review is waiting on, so it is still the rung
    // that gets planned: somebody asking for quiet is not asking to be told about
    // the same review on a different rung instead.
    expect(planned?.kind).toBe('ai_review_parked')
    expect(planned?.dueAt).toBe(3 * DAY)
  })

  it('stops carrying a pause the ladder has already moved past', () => {
    const planned = planNextReminder(review(), policy, [snoozed(HOUR)], NOTHING_PARKED)
    expect(planned?.dueAt).toBe(4 * HOUR)
    expect(planned?.snoozedUntil).toBeNull()
  })

  it('ignores a pause on a nudge that has already gone out', () => {
    // The snooze held the nudge back and the nudge then happened, which is the end
    // of what it asked for. Read off a sent row instead, it would defer the whole
    // ladder for ever.
    const sent = [sentReminder({ kind: 'unassigned', sentAt: HOUR, snoozedUntil: 3 * DAY })]
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0 }),
      policy,
      sent,
      NOTHING_PARKED,
    )
    expect(planned?.dueAt).toBe(DAY)
    expect(planned?.snoozedUntil).toBeNull()
  })
})

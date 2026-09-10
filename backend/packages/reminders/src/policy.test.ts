import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { DEFAULT_REMINDER_POLICY } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { cadenceMultiplier, isResolved, planNextReminder } from './policy.js'

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

function sentReminder(overrides: Partial<Reminder> & { kind: Reminder['kind'] }): Reminder {
  return {
    id: 'rem-1',
    reviewId: 'rev-1',
    channel: 'slack_dm',
    reviewerId: null,
    dueAt: 0,
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

describe('planNextReminder', () => {
  const policy = DEFAULT_REMINDER_POLICY

  it('plans nothing for a resolved review', () => {
    expect(planNextReminder(review({ status: 'approved' }), policy, [])).toBeNull()
  })

  it('chases an unclaimed review in the channel', () => {
    const planned = planNextReminder(review(), policy, [])
    expect(planned).toStrictEqual({
      reviewId: 'rev-1',
      kind: 'unassigned',
      channel: 'slack_channel',
      reviewerId: null,
      dueAt: 4 * HOUR,
    })
  })

  it('does not chase an unclaimed review twice', () => {
    const sent = [sentReminder({ kind: 'unassigned', channel: 'slack_channel' })]
    expect(planNextReminder(review(), policy, sent)).toBeNull()
  })

  it('DMs the assigned reviewer a day after assignment', () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: HOUR }),
      policy,
      [],
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
    )
    expect(planned?.kind).toBe('pending')
  })

  it('does not let a distant deadline silence the nudge that is due first', () => {
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 7 * DAY }),
      policy,
      [],
    )
    expect(planned?.kind).toBe('pending')
    expect(planned?.dueAt).toBe(DAY)
  })

  it('chases an unclaimed review in the channel before its deadline escalation', () => {
    const planned = planNextReminder(review({ dueAt: 7 * DAY }), policy, [])
    expect(planned?.kind).toBe('unassigned')
    expect(planned?.dueAt).toBe(4 * HOUR)
  })

  it('escalates once the deadline comes round before the next nudge', () => {
    const sent = [sentReminder({ kind: 'pending', sentAt: 5 * DAY })]
    const planned = planNextReminder(
      review({ status: 'assigned', assignedReviewerIds: ['rvw-1'], assignedAt: 0, dueAt: 4 * DAY }),
      policy,
      sent,
    )
    expect(planned?.kind).toBe('escalation')
    expect(planned?.dueAt).toBe(5 * DAY)
  })
})

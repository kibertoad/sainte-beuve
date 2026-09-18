import type { Reviewer, ReviewRequest } from '@sainte-beuve/contracts'
import { ACTIVE_REVIEW_STATUSES, NO_VCS_HANDLES } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { buildBoard, isOverdue, isSettledReview } from './board.js'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function review(id: string, overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id,
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 1,
      url: 'https://github.com/kibertoad/sainte-beuve/pull/1',
    },
    title: 'A change',
    authorLogin: 'someone',
    requiredSkills: [],
    priority: 'normal',
    status: 'open',
    assignedReviewerIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    assignedAt: null,
    dueAt: null,
    ...overrides,
  }
}

function reviewer(id: string, displayName: string): Reviewer {
  return {
    id,
    displayName,
    handles: NO_VCS_HANDLES,
    slackUserId: null,
    team: null,
    skills: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: NOW,
  }
}

const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id)

describe('buildBoard', () => {
  it('names the people on the hook, in assignment order', () => {
    const board = buildBoard(
      [review('rev-1', { assignedReviewerIds: ['r-2', 'r-1'] })],
      [reviewer('r-1', 'Ada'), reviewer('r-2', 'Grace')],
      NOW,
    )

    expect(board[0]?.assignedReviewers).toStrictEqual([
      { reviewerId: 'r-2', displayName: 'Grace' },
      { reviewerId: 'r-1', displayName: 'Ada' },
    ])
  })

  it('drops an id the directory no longer holds rather than rendering it', () => {
    // Somebody removed from the directory leaves their id on every review they
    // were on. The review is still assigned; this deployment just cannot say to
    // whom, and an opaque id on the row says that badly.
    const board = buildBoard(
      [review('rev-1', { assignedReviewerIds: ['r-1', 'gone'] })],
      [reviewer('r-1', 'Ada')],
      NOW,
    )

    expect(board[0]?.assignedReviewers).toStrictEqual([{ reviewerId: 'r-1', displayName: 'Ada' }])
    expect(board[0]?.assignedReviewerIds).toHaveLength(2)
  })

  it('puts an overdue review above a high-priority one that is not', () => {
    const late = review('rev-late', { priority: 'low', dueAt: NOW - HOUR })
    const urgent = review('rev-urgent', { priority: 'high' })

    expect(ids(buildBoard([urgent, late], [], NOW))).toStrictEqual(['rev-late', 'rev-urgent'])
  })

  it('does not treat a deadline that has not passed as overdue', () => {
    const soon = review('rev-soon', { priority: 'low', dueAt: NOW + HOUR })
    const urgent = review('rev-urgent', { priority: 'high' })

    expect(ids(buildBoard([soon, urgent], [], NOW))).toStrictEqual(['rev-urgent', 'rev-soon'])
  })

  it('orders equal priorities oldest first, because that is what has waited', () => {
    const old = review('rev-old', { createdAt: NOW - 5 * HOUR })
    const recent = review('rev-recent', { createdAt: NOW - HOUR })

    expect(ids(buildBoard([recent, old], [], NOW))).toStrictEqual(['rev-old', 'rev-recent'])
  })

  it('sorts settled reviews below every active one, newest first', () => {
    const approved = review('rev-approved', { status: 'approved', updatedAt: NOW - HOUR })
    const closed = review('rev-closed', { status: 'closed', updatedAt: NOW })
    const waiting = review('rev-waiting', { priority: 'low', createdAt: NOW - 9 * HOUR })

    expect(ids(buildBoard([approved, closed, waiting], [], NOW))).toStrictEqual([
      'rev-waiting',
      'rev-closed',
      'rev-approved',
    ])
  })

  it('is a TOTAL order, so two reviews of one age do not swap between reads', () => {
    const a = review('rev-a')
    const b = review('rev-b')

    expect(ids(buildBoard([b, a], [], NOW))).toStrictEqual(ids(buildBoard([a, b], [], NOW)))
  })

  it('leaves the input alone', () => {
    const rows = [review('rev-b'), review('rev-a', { createdAt: NOW - HOUR })]

    buildBoard(rows, [], NOW)

    expect(ids(rows)).toStrictEqual(['rev-b', 'rev-a'])
  })
})

describe('isOverdue', () => {
  it('is true only once the deadline has passed', () => {
    expect(isOverdue({ dueAt: null }, NOW)).toBe(false)
    expect(isOverdue({ dueAt: NOW + 1 }, NOW)).toBe(false)
    expect(isOverdue({ dueAt: NOW }, NOW)).toBe(true)
  })
})

describe('isSettledReview', () => {
  it('is exactly the complement of the statuses the board is about', () => {
    expect(ACTIVE_REVIEW_STATUSES.map(isSettledReview)).toStrictEqual([false, false, false])
    expect(
      (['approved', 'changes_requested', 'closed'] as const).map(isSettledReview),
    ).toStrictEqual([true, true, true])
  })
})

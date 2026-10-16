import type { ToReviewReasons } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { formatElapsed, toReviewChips } from '../app/utils/toReview'

const HOUR = 3_600_000
const DAY = 24 * HOUR

function reasons(fields: Partial<ToReviewReasons> = {}): ToReviewReasons {
  return {
    committedAt: null,
    commitmentId: null,
    requested: false,
    othersCommitted: 0,
    reviewerLogins: [],
    unreviewedForMs: null,
    matchedSkills: [],
    matchedDomains: [],
    fit: 0,
    pastReviews: 0,
    authored: 0,
    ...fields,
  }
}

function labels(fields: Partial<ToReviewReasons>): string[] {
  return toReviewChips(reasons(fields)).map((chip) => chip.label)
}

describe('formatElapsed', () => {
  it('uses the largest whole unit', () => {
    expect(formatElapsed(5 * 60_000)).toBe('5 minutes')
    expect(formatElapsed(HOUR)).toBe('1 hour')
    expect(formatElapsed(3 * DAY + 5 * HOUR)).toBe('3 days')
    expect(formatElapsed(15 * DAY)).toBe('2 weeks')
  })

  it('never says zero', () => {
    expect(formatElapsed(0)).toBe('1 minute')
  })
})

describe('toReviewChips', () => {
  it('says nothing about a pull request with no reason to rank', () => {
    expect(labels({})).toEqual([])
  })

  it('flags an unreviewed pull request nobody committed to', () => {
    expect(labels({ unreviewedForMs: 3 * DAY })).toEqual([
      'No review for 3 days',
      'Nobody committed',
    ])
  })

  it('does not call it uncommitted when the viewer or others committed', () => {
    expect(labels({ unreviewedForMs: DAY, committedAt: 1 })).toEqual([
      'You committed',
      'No review for 1 day',
    ])
    expect(labels({ unreviewedForMs: DAY, othersCommitted: 2 })).toEqual([
      '2 others committed',
      'No review for 1 day',
    ])
  })

  it('names the reviewers once somebody reviewed it, and counts past three', () => {
    expect(labels({ reviewerLogins: ['alice', 'bob'] })).toEqual(['Reviewed by alice, bob'])
    expect(labels({ reviewerLogins: ['a', 'b', 'c', 'd', 'e'] })).toEqual([
      'Reviewed by a, b, c and 2 more',
    ])
  })

  it('reports the fit and the history in the repository', () => {
    expect(
      labels({
        requested: true,
        matchedSkills: ['Backend'],
        matchedDomains: ['payments'],
        pastReviews: 4,
        authored: 2,
      }),
    ).toEqual([
      'Requested from you',
      'Matches Backend, payments',
      'You reviewed 4 here',
      'You opened 2 here',
    ])
  })
})

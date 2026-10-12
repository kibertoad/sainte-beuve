import type { ReviewRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  PAST_REVIEW_HALF_POINT,
  PAST_REVIEW_PREFERENCE,
  countPastReviews,
  familiarityBonus,
} from './familiarity.js'

function settled(
  status: ReviewRequest['status'],
  assignedReviewerIds: string[],
): Pick<ReviewRequest, 'status' | 'assignedReviewerIds'> {
  return { status, assignedReviewerIds }
}

describe('familiarityBonus', () => {
  it('adds nothing for somebody who never reviewed the repository', () => {
    expect(familiarityBonus(0)).toBe(0)
  })

  it('earns half the preference at the half point', () => {
    expect(familiarityBonus(PAST_REVIEW_HALF_POINT)).toBe(PAST_REVIEW_PREFERENCE / 2)
  })

  it('keeps rising with each review by less than the one before, and never reaches the cap', () => {
    const steps = [1, 2, 3, 4].map((n) => familiarityBonus(n) - familiarityBonus(n - 1))
    expect(steps).toStrictEqual(steps.toSorted((a, b) => b - a))
    expect(familiarityBonus(10_000)).toBeLessThan(PAST_REVIEW_PREFERENCE)
  })
})

describe('countPastReviews', () => {
  it('counts each finished review once for everyone on it', () => {
    const counts = countPastReviews([
      settled('approved', ['ann', 'bea']),
      settled('changes_requested', ['ann']),
      settled('approved', ['ann', 'ann']),
    ])
    expect(Object.fromEntries(counts)).toStrictEqual({ ann: 3, bea: 1 })
  })

  it('leaves out reviews that are still running or were closed unreviewed', () => {
    const counts = countPastReviews([
      settled('assigned', ['ann']),
      settled('in_review', ['ann']),
      settled('closed', ['ann']),
    ])
    expect(counts.size).toBe(0)
  })
})

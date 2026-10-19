import type { ReviewerSuggestions } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  askedLabel,
  askLabel,
  involvementLabel,
  reviewersToAsk,
  searchableReviewers,
} from '../app/utils/reviewerSuggestions'

// What the "Suggest reviewers" dialog asks and says. The ranking itself is the
// server's; the dialog only combines the ticked matches with the people added
// by search, and must not ask anybody twice.

describe('reviewersToAsk', () => {
  it('asks the ticked matches first and each person once', () => {
    expect(reviewersToAsk(['ann', 'bob'], ['cat', 'ann'])).toStrictEqual(['ann', 'bob', 'cat'])
  })
})

describe('searchableReviewers', () => {
  it('offers everybody the ranking left out, with their team when they have one', () => {
    const suggestions = {
      others: [
        { reviewerId: 'r-1', displayName: 'Ann', team: 'Payments' },
        { reviewerId: 'r-2', displayName: 'Bob', team: null },
      ],
    } as ReviewerSuggestions

    expect(searchableReviewers(suggestions)).toStrictEqual([
      { label: 'Ann · Payments', value: 'r-1' },
      { label: 'Bob', value: 'r-2' },
    ])
  })
})

describe('labels', () => {
  it('counts the people asked', () => {
    expect(askLabel(0)).toBe('Pick somebody to ask')
    expect(askLabel(1)).toBe('Ask 1 reviewer')
    expect(askLabel(3)).toBe('Ask 3 reviewers')
    expect(askedLabel(2)).toBe('Asked 2 reviewers')
  })

  it('says how somebody is already on the pull request', () => {
    expect(involvementLabel('committed')).toBe('Committed')
    expect(involvementLabel('asked')).toBe('Asked, no answer yet')
    expect(involvementLabel('requested')).toBe('Requested on the host')
    expect(involvementLabel('declined')).toBe('Declined')
  })
})

import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { createReviewerSchema, reviewerSchema, updateReviewerSchema } from './reviewers.js'

describe('createReviewerSchema', () => {
  it('fills the defaults a caller may omit', () => {
    const parsed = v.parse(createReviewerSchema, { displayName: 'Ada' })
    expect(parsed).toStrictEqual({
      displayName: 'Ada',
      handles: { github: null, gitlab: null },
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      // `member`, not `admin`. The migration is what makes the rows that
      // predate roles admins; a row somebody is creating now is the narrower
      // one, because it decides who else can change the deployment.
      role: 'member',
      weight: 1,
    })
  })

  it('takes one host handle and leaves the other unset', () => {
    const parsed = v.parse(createReviewerSchema, {
      displayName: 'Ada',
      handles: { gitlab: 'ada' },
    })
    expect(parsed.handles).toStrictEqual({ github: null, gitlab: 'ada' })
  })

  it('trims a display name rather than storing the whitespace', () => {
    expect(v.parse(createReviewerSchema, { displayName: '  Ada  ' }).displayName).toBe('Ada')
  })

  it('refuses a blank display name', () => {
    expect(() => v.parse(createReviewerSchema, { displayName: '   ' })).toThrow()
  })

  it('refuses a negative weight', () => {
    expect(() => v.parse(createReviewerSchema, { displayName: 'Ada', weight: -1 })).toThrow()
  })
})

describe('reviewerSchema', () => {
  it('refuses a fractional outstanding count', () => {
    const row = {
      id: 'r1',
      displayName: 'Ada',
      handles: { github: null, gitlab: null },
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      // `member`, not `admin`. The migration is what makes the rows that
      // predate roles admins; a row somebody is creating now is the narrower
      // one, because it decides who else can change the deployment.
      role: 'member',
      weight: 1,
      outstandingReviews: 1.5,
      createdAt: 0,
    }
    expect(() => v.parse(reviewerSchema, row)).toThrow()
  })

  // A 0 parsed cleanly while the comment beside it said "0 excluded". `isEligible`
  // drops a reviewer at or below 0, so the row was a person who never came up again
  // and still rendered as available.
  it('refuses a weight of 0, which would silently remove the person from every draw', () => {
    expect(() => v.parse(createReviewerSchema, { displayName: 'Ada', weight: 0 })).toThrow()
    expect(() => v.parse(updateReviewerSchema, { weight: 0 })).toThrow()
  })

  it('still takes a fractional weight, which is the point of the field', () => {
    expect(v.parse(updateReviewerSchema, { weight: 0.25 })).toStrictEqual({ weight: 0.25 })
  })
})

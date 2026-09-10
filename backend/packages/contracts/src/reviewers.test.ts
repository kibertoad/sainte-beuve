import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { createReviewerSchema, reviewerSchema } from './reviewers.js'

describe('createReviewerSchema', () => {
  it('fills the defaults a caller may omit', () => {
    const parsed = v.parse(createReviewerSchema, { displayName: 'Ada' })
    expect(parsed).toStrictEqual({
      displayName: 'Ada',
      githubLogin: null,
      slackUserId: null,
      skills: [],
      availability: 'available',
      weight: 1,
    })
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
      githubLogin: null,
      slackUserId: null,
      skills: [],
      availability: 'available',
      weight: 1,
      outstandingReviews: 1.5,
      createdAt: 0,
    }
    expect(() => v.parse(reviewerSchema, row)).toThrow()
  })
})

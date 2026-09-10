import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { assignReviewersSchema, createReviewRequestSchema } from './reviews.js'

const PR = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 1,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/1',
}

describe('createReviewRequestSchema', () => {
  it('defaults priority and skills so a minimal caller works', () => {
    const parsed = v.parse(createReviewRequestSchema, {
      pullRequest: PR,
      title: 'Add a health check',
      authorLogin: 'kibertoad',
    })
    expect(parsed.priority).toBe('normal')
    expect(parsed.requiredSkills).toStrictEqual([])
    expect(parsed.dueAt).toBeNull()
  })

  it('refuses a pull request number of zero', () => {
    expect(() =>
      v.parse(createReviewRequestSchema, {
        pullRequest: { ...PR, number: 0 },
        title: 'x',
        authorLogin: 'y',
      }),
    ).toThrow()
  })

  it('refuses a pull request url that is not a url', () => {
    expect(() =>
      v.parse(createReviewRequestSchema, {
        pullRequest: { ...PR, url: 'not-a-url' },
        title: 'x',
        authorLogin: 'y',
      }),
    ).toThrow()
  })
})

describe('assignReviewersSchema', () => {
  it('asks for one reviewer when the caller says nothing', () => {
    expect(v.parse(assignReviewersSchema, {})).toStrictEqual({ count: 1, excludeReviewerIds: [] })
  })

  it('caps how many reviewers one call can put on the hook', () => {
    expect(() => v.parse(assignReviewersSchema, { count: 6 })).toThrow()
  })
})

import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { NO_PAST_REVIEWS } from './familiarity.js'
import { rankCandidates } from './recommendation.js'

function reviewer(overrides: Partial<Reviewer> & { id: string }): Reviewer {
  return {
    displayName: overrides.id,
    handles: { github: overrides.id, gitlab: null },
    slackUserId: null,
    team: null,
    skills: [],
    domains: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: 0,
    ...overrides,
  }
}

const target = {
  skills: ['typescript', 'payments'],
  domains: ['billing'],
  pastReviews: NO_PAST_REVIEWS,
}

function ids(result: ReturnType<typeof rankCandidates>): string[] {
  return result.ranked.map((candidate) => candidate.reviewer.id)
}

describe('rankCandidates', () => {
  it('puts the closest match first and names what each one matched', () => {
    const result = rankCandidates({
      ...target,
      candidates: [
        reviewer({ id: 'stranger', skills: ['go'] }),
        reviewer({ id: 'full', skills: ['TypeScript', 'payments'], domains: ['Billing'] }),
        reviewer({ id: 'half', skills: ['typescript'] }),
      ],
      excludeReviewerIds: [],
      limit: 10,
    })
    expect(ids(result)).toStrictEqual(['full', 'half', 'stranger'])
    expect(result.ranked[0]?.matchedSkills).toStrictEqual(['typescript', 'payments'])
    expect(result.ranked[0]?.matchedDomains).toStrictEqual(['billing'])
    expect(result.ranked[2]?.matchedSkills).toStrictEqual([])
    expect(result.shortfallReason).toBeNull()
  })

  it('ranks a busy expert below an idle one, as the draw weighs them', () => {
    const result = rankCandidates({
      ...target,
      candidates: [
        reviewer({ id: 'busy', skills: ['typescript', 'payments'], outstandingReviews: 3 }),
        reviewer({ id: 'idle', skills: ['typescript', 'payments'] }),
      ],
      excludeReviewerIds: [],
      limit: 10,
    })
    expect(ids(result)).toStrictEqual(['idle', 'busy'])
  })

  it('lifts somebody who has reviewed the repository before over an equal stranger', () => {
    const result = rankCandidates({
      ...target,
      candidates: [
        reviewer({ id: 'stranger', skills: ['typescript'] }),
        reviewer({ id: 'regular', skills: ['typescript'] }),
      ],
      excludeReviewerIds: [],
      pastReviews: new Map([['regular', 2]]),
      limit: 10,
    })
    expect(ids(result)).toStrictEqual(['regular', 'stranger'])
    expect(result.ranked.map((candidate) => candidate.pastReviews)).toStrictEqual([2, 0])
  })

  it('still ranks the whole wanted mix over any amount of history', () => {
    const result = rankCandidates({
      ...target,
      candidates: [
        reviewer({ id: 'regular' }),
        reviewer({ id: 'expert', skills: ['typescript', 'payments'], domains: ['billing'] }),
      ],
      excludeReviewerIds: [],
      pastReviews: new Map([['regular', 1000]]),
      limit: 10,
    })
    expect(ids(result)).toStrictEqual(['expert', 'regular'])
  })

  it('breaks a tie on the name, then the id, whatever order the directory came in', () => {
    const candidates = [
      reviewer({ id: 'b2', displayName: 'Bea' }),
      reviewer({ id: 'a1', displayName: 'Ann' }),
      reviewer({ id: 'b1', displayName: 'Bea' }),
    ]
    const forward = rankCandidates({ ...target, candidates, excludeReviewerIds: [], limit: 10 })
    const reversed = rankCandidates({
      ...target,
      candidates: candidates.toReversed(),
      excludeReviewerIds: [],
      limit: 10,
    })
    expect(ids(forward)).toStrictEqual(['a1', 'b1', 'b2'])
    expect(ids(reversed)).toStrictEqual(ids(forward))
  })

  it('leaves out the excluded, the paused and anyone past the limit', () => {
    const result = rankCandidates({
      ...target,
      candidates: [
        reviewer({ id: 'author', skills: ['typescript'] }),
        reviewer({ id: 'paused', skills: ['typescript'], availability: 'paused' }),
        reviewer({ id: 'a' }),
        reviewer({ id: 'b' }),
      ],
      excludeReviewerIds: ['author'],
      limit: 1,
    })
    expect(ids(result)).toStrictEqual(['a'])
  })

  it('says why when nobody can be recommended', () => {
    expect(
      rankCandidates({ ...target, candidates: [], excludeReviewerIds: [], limit: 5 })
        .shortfallReason,
    ).toBe('no_reviewers')
    expect(
      rankCandidates({
        ...target,
        candidates: [reviewer({ id: 'author' })],
        excludeReviewerIds: ['author'],
        limit: 5,
      }).shortfallReason,
    ).toBe('all_excluded')
  })
})

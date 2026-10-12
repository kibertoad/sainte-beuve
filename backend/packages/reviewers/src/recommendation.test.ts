import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { type RankingInput, rankCandidates } from './recommendation.js'

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

function rank(input: Partial<RankingInput> & Pick<RankingInput, 'candidates'>) {
  return rankCandidates({
    skills: ['typescript', 'payments'],
    domains: ['billing'],
    audience: { requestedById: 'asker', team: null, sameTeamOnly: false },
    excludeReviewerIds: [],
    limit: 10,
    ...input,
  })
}

function ids(result: ReturnType<typeof rankCandidates>): string[] {
  return result.ranked.map((candidate) => candidate.reviewer.id)
}

describe('rankCandidates', () => {
  it('puts the closest match first and names what each one matched', () => {
    const result = rank({
      candidates: [
        reviewer({ id: 'stranger', skills: ['go'] }),
        reviewer({ id: 'full', skills: ['TypeScript', 'payments'], domains: ['Billing'] }),
        reviewer({ id: 'half', skills: ['typescript'] }),
      ],
    })
    expect(ids(result)).toStrictEqual(['full', 'half', 'stranger'])
    expect(result.ranked[0]?.matchedSkills).toStrictEqual(['typescript', 'payments'])
    expect(result.ranked[0]?.matchedDomains).toStrictEqual(['billing'])
    expect(result.ranked[0]?.affinity).toBe(1)
    expect(result.ranked[2]?.matchedSkills).toStrictEqual([])
    expect(result.shortfallReason).toBeNull()
  })

  it('ranks a busy expert above an idle partial match, and load only among equal fits', () => {
    const result = rank({
      candidates: [
        reviewer({ id: 'idle-half', skills: ['typescript'] }),
        reviewer({ id: 'busy', skills: ['typescript', 'payments'], outstandingReviews: 3 }),
        reviewer({ id: 'idle', skills: ['typescript', 'payments'] }),
      ],
    })
    expect(ids(result)).toStrictEqual(['idle', 'busy', 'idle-half'])
  })

  it('prefers the larger configured weight among equal fits and loads', () => {
    const result = rank({
      candidates: [reviewer({ id: 'part-time', weight: 0.5 }), reviewer({ id: 'full-time' })],
    })
    expect(ids(result)).toStrictEqual(['full-time', 'part-time'])
  })

  it('breaks a tie on the name, then the id, whatever order the directory came in', () => {
    const candidates = [
      reviewer({ id: 'b2', displayName: 'Bea' }),
      reviewer({ id: 'a1', displayName: 'Ann' }),
      reviewer({ id: 'b1', displayName: 'Bea' }),
    ]
    const forward = rank({ candidates })
    const reversed = rank({ candidates: candidates.toReversed() })
    expect(ids(forward)).toStrictEqual(['a1', 'b1', 'b2'])
    expect(ids(reversed)).toStrictEqual(ids(forward))
  })

  it('recommends whoever an ask could reach: weight 0 is in, the asker and the paused are out', () => {
    const result = rank({
      candidates: [
        reviewer({ id: 'asker', skills: ['typescript'] }),
        reviewer({ id: 'author', skills: ['typescript'] }),
        reviewer({ id: 'paused', skills: ['typescript'], availability: 'paused' }),
        reviewer({ id: 'unrouted', weight: 0 }),
      ],
      excludeReviewerIds: ['author'],
    })
    expect(ids(result)).toStrictEqual(['unrouted'])
  })

  it("keeps to the asker's team when the ask does", () => {
    const result = rank({
      candidates: [
        reviewer({ id: 'mine', team: 'Core' }),
        reviewer({ id: 'theirs', team: 'Web', skills: ['typescript', 'payments'] }),
      ],
      audience: { requestedById: 'asker', team: 'core', sameTeamOnly: true },
    })
    expect(ids(result)).toStrictEqual(['mine'])
  })

  it('stops at the limit', () => {
    const result = rank({ candidates: [reviewer({ id: 'a' }), reviewer({ id: 'b' })], limit: 1 })
    expect(ids(result)).toStrictEqual(['a'])
  })

  it('says why when nobody can be recommended', () => {
    expect(rank({ candidates: [] }).shortfallReason).toBe('no_reviewers')
    expect(
      rank({ candidates: [reviewer({ id: 'p', availability: 'paused' })] }).shortfallReason,
    ).toBe('none_available')
    expect(rank({ candidates: [reviewer({ id: 'asker' })] }).shortfallReason).toBe('all_excluded')
  })
})

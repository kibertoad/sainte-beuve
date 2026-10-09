import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  MATCH_PREFERENCE,
  type SelectionInput,
  drawWeight,
  isEligible,
  isSameHandle,
  matchTargetFor,
  scoreCandidates,
  selectReviewers,
} from './selection.js'

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

/** A scripted `random()`: returns each value in turn, then repeats the last one. */
function scripted(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

/** A selection over `candidates` that wants nothing in particular, unless told. */
function input(candidates: Reviewer[], overrides: Partial<SelectionInput> = {}): SelectionInput {
  return { candidates, skills: [], domains: [], excludeReviewerIds: [], count: 1, ...overrides }
}

describe('isEligible', () => {
  it('admits anyone available, whatever their skills', () => {
    expect(isEligible(reviewer({ id: 'a' }), new Set())).toBe(true)
  })

  it('skips paused reviewers, zero-weight reviewers and the exclusion list', () => {
    expect(isEligible(reviewer({ id: 'a', availability: 'paused' }), new Set())).toBe(false)
    expect(isEligible(reviewer({ id: 'b', weight: 0 }), new Set())).toBe(false)
    expect(isEligible(reviewer({ id: 'c' }), new Set(['c']))).toBe(false)
  })
})

describe('drawWeight', () => {
  it('damps a reviewer by their outstanding load', () => {
    expect(drawWeight(reviewer({ id: 'idle', weight: 1 }))).toBe(1)
    expect(drawWeight(reviewer({ id: 'busy', weight: 1, outstandingReviews: 3 }))).toBe(0.25)
  })

  it('keeps a part-time reviewer proportionally rarer at equal load', () => {
    const full = drawWeight(reviewer({ id: 'full', weight: 1 }))
    const half = drawWeight(reviewer({ id: 'half', weight: 0.5 }))
    expect(half).toBe(full / 2)
  })
})

describe('match scoring', () => {
  const target = { skills: ['typescript'], domains: ['billing'] }

  it('weights skills and domains alike, by the share of the mix a reviewer holds', () => {
    const scored = scoreCandidates(
      [
        reviewer({ id: 'both', skills: ['TypeScript'], domains: ['Billing'] }),
        reviewer({ id: 'skill', skills: ['typescript'] }),
        reviewer({ id: 'domain', domains: ['billing'] }),
        reviewer({ id: 'neither', skills: ['go'] }),
      ],
      target,
      [],
    ).map((candidate) => [candidate.reviewer.id, candidate.weight])
    expect(scored).toStrictEqual([
      ['both', 1 + MATCH_PREFERENCE],
      ['skill', 1 + MATCH_PREFERENCE / 2],
      ['domain', 1 + MATCH_PREFERENCE / 2],
      ['neither', 1],
    ])
  })

  it('applies the match on top of the load damping', () => {
    const busy = reviewer({
      id: 'busy',
      skills: ['typescript'],
      domains: ['billing'],
      outstandingReviews: 1,
    })
    expect(scoreCandidates([busy], target, [])[0]?.weight).toBe((1 + MATCH_PREFERENCE) / 2)
  })

  it('leaves the draw to load and weight when the review wants nothing', () => {
    const scored = scoreCandidates(
      [reviewer({ id: 'a', skills: ['go'] })],
      { skills: [], domains: [] },
      [],
    )
    expect(scored[0]?.weight).toBe(1)
  })
})

describe('matchTargetFor', () => {
  const project = { skills: ['Backend'], domains: ['billing'] }

  it("wants the review's own skills over the repository's", () => {
    expect(matchTargetFor({ requiredSkills: ['go'] }, project)).toStrictEqual({
      skills: ['go'],
      domains: ['billing'],
    })
  })

  it("falls back to the repository's skills when the review names none", () => {
    expect(matchTargetFor({ requiredSkills: [] }, project).skills).toStrictEqual(['Backend'])
  })

  it('wants only what the review asked for on an unregistered repository', () => {
    expect(matchTargetFor({ requiredSkills: [] }, null)).toStrictEqual({ skills: [], domains: [] })
  })
})

describe('selectReviewers', () => {
  const pool = [
    reviewer({ id: 'a', skills: ['typescript'] }),
    reviewer({ id: 'b', skills: ['typescript'] }),
    reviewer({ id: 'c', skills: ['go'] }),
  ]
  const paused = pool.map((candidate) => ({ ...candidate, availability: 'paused' as const }))

  // Weights 1, 1 and 5 when `go` is wanted: half the total lands on `c`, where
  // with equal weights it lands on `b`.
  it('moves the draw towards the reviewer holding the wanted skill', () => {
    const wanted = selectReviewers(input(pool, { skills: ['go'] }), scripted([0.5]))
    const unwanted = selectReviewers(input(pool), scripted([0.5]))
    expect(wanted.selected.map((r) => r.id)).toStrictEqual(['c'])
    expect(unwanted.selected.map((r) => r.id)).toStrictEqual(['b'])
  })

  it('still assigns somebody when nobody holds the wanted skill', () => {
    const result = selectReviewers(input(pool, { skills: ['rust'] }), scripted([0]))
    expect(result.selected).toHaveLength(1)
    expect(result.shortfallReason).toBeNull()
  })

  it('reports no_reviewers when the directory is empty', () => {
    expect(selectReviewers(input([]), scripted([0])).shortfallReason).toBe('no_reviewers')
  })

  it('reports none_available when everybody is paused', () => {
    expect(selectReviewers(input(paused), scripted([0])).shortfallReason).toBe('none_available')
  })

  it('reports all_excluded when everybody available is the author or already on it', () => {
    const result = selectReviewers(
      input(pool, { excludeReviewerIds: ['a', 'b', 'c'] }),
      scripted([0]),
    )
    expect(result.selected).toStrictEqual([])
    expect(result.shortfallReason).toBe('all_excluded')
  })

  it('never picks the same reviewer twice', () => {
    const result = selectReviewers(input(pool, { count: 2 }), scripted([0, 0]))
    expect(new Set(result.selected.map((r) => r.id)).size).toBe(2)
  })

  it('reports pool_exhausted when it runs out before count', () => {
    const result = selectReviewers(
      input(pool, { excludeReviewerIds: ['a', 'b'], count: 2 }),
      scripted([0]),
    )
    expect(result.selected.map((r) => r.id)).toStrictEqual(['c'])
    expect(result.shortfallReason).toBe('pool_exhausted')
  })

  it('lands on the candidate the draw threshold falls in', () => {
    // Equal weights over three candidates: thresholds < 1/3 pick the first, and
    // ~0.5 of the total picks the second.
    const first = selectReviewers(input(pool), scripted([0.1]))
    const second = selectReviewers(input(pool), scripted([0.5]))
    expect(first.selected.map((r) => r.id)).toStrictEqual(['a'])
    expect(second.selected.map((r) => r.id)).toStrictEqual(['b'])
  })
})

describe('isSameHandle', () => {
  it('matches the same account however it is spelled', () => {
    expect(isSameHandle('Kibertoad', 'kibertoad')).toBe(true)
    expect(isSameHandle(' kibertoad ', 'KIBERTOAD')).toBe(true)
  })

  it('does not match two different people, or a reviewer with no login at all', () => {
    expect(isSameHandle('kibertoad', 'someone-else')).toBe(false)
    expect(isSameHandle(null, 'kibertoad')).toBe(false)
    expect(isSameHandle(null, null)).toBe(false)
  })
})

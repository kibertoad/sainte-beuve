import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { drawWeight, isEligible, isSameHandle, selectReviewers } from './selection.js'

function reviewer(overrides: Partial<Reviewer> & { id: string }): Reviewer {
  return {
    displayName: overrides.id,
    handles: { github: overrides.id, gitlab: null },
    slackUserId: null,
    team: null,
    skills: [],
    availability: 'available',
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

describe('isEligible', () => {
  it('requires every skill, not just one', () => {
    const candidate = reviewer({ id: 'a', skills: ['typescript'] })
    expect(isEligible(candidate, ['typescript', 'payments'], new Set())).toBe(false)
    expect(isEligible(candidate, ['typescript'], new Set())).toBe(true)
  })

  it('matches skills case-insensitively', () => {
    const candidate = reviewer({ id: 'a', skills: ['TypeScript'] })
    expect(isEligible(candidate, ['typescript'], new Set())).toBe(true)
  })

  it('admits anyone available when no skills are required', () => {
    expect(isEligible(reviewer({ id: 'a' }), [], new Set())).toBe(true)
  })

  it('skips paused reviewers, zero-weight reviewers and the exclusion list', () => {
    expect(isEligible(reviewer({ id: 'a', availability: 'paused' }), [], new Set())).toBe(false)
    expect(isEligible(reviewer({ id: 'b', weight: 0 }), [], new Set())).toBe(false)
    expect(isEligible(reviewer({ id: 'c' }), [], new Set(['c']))).toBe(false)
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

describe('selectReviewers', () => {
  const pool = [
    reviewer({ id: 'a', skills: ['typescript'] }),
    reviewer({ id: 'b', skills: ['typescript'] }),
    reviewer({ id: 'c', skills: ['go'] }),
  ]

  it('picks only reviewers holding the required skill', () => {
    const result = selectReviewers(
      { candidates: pool, requiredSkills: ['go'], excludeReviewerIds: [], count: 1 },
      scripted([0]),
    )
    expect(result.selected.map((r) => r.id)).toStrictEqual(['c'])
    expect(result.shortfallReason).toBeNull()
  })

  it('reports no_candidates when nobody has the skill', () => {
    const result = selectReviewers(
      { candidates: pool, requiredSkills: ['rust'], excludeReviewerIds: [], count: 1 },
      scripted([0]),
    )
    expect(result.selected).toStrictEqual([])
    expect(result.shortfallReason).toBe('no_candidates')
  })

  it('never picks the same reviewer twice', () => {
    const result = selectReviewers(
      { candidates: pool, requiredSkills: ['typescript'], excludeReviewerIds: [], count: 2 },
      scripted([0, 0]),
    )
    expect(new Set(result.selected.map((r) => r.id)).size).toBe(2)
  })

  it('reports pool_exhausted when it runs out before count', () => {
    const result = selectReviewers(
      { candidates: pool, requiredSkills: ['go'], excludeReviewerIds: [], count: 2 },
      scripted([0]),
    )
    expect(result.selected.map((r) => r.id)).toStrictEqual(['c'])
    expect(result.shortfallReason).toBe('pool_exhausted')
  })

  it('lands on the candidate the draw threshold falls in', () => {
    // Equal weights over three candidates: thresholds < 1/3 pick the first, and
    // ~0.5 of the total picks the second.
    const first = selectReviewers(
      { candidates: pool, requiredSkills: [], excludeReviewerIds: [], count: 1 },
      scripted([0.1]),
    )
    const second = selectReviewers(
      { candidates: pool, requiredSkills: [], excludeReviewerIds: [], count: 1 },
      scripted([0.5]),
    )
    expect(first.selected.map((r) => r.id)).toStrictEqual(['a'])
    expect(second.selected.map((r) => r.id)).toStrictEqual(['b'])
  })

  it('honours the exclusion list', () => {
    const result = selectReviewers(
      { candidates: pool, requiredSkills: [], excludeReviewerIds: ['a', 'b'], count: 2 },
      scripted([0]),
    )
    expect(result.selected.map((r) => r.id)).toStrictEqual(['c'])
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

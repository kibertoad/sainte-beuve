import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  type AttentionAudienceRule,
  isAttentionSatisfied,
  isInAttentionAudience,
  outstandingCommitments,
  selectAttentionAudience,
} from './attention.js'

function reviewer(overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id: 'r-1',
    displayName: 'Reviewer',
    handles: { github: 'reviewer', gitlab: null },
    slackUserId: null,
    team: null,
    skills: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: 0,
    ...overrides,
  }
}

function rule(overrides: Partial<AttentionAudienceRule> = {}): AttentionAudienceRule {
  return {
    requiredSkills: [],
    sameTeamOnly: false,
    team: null,
    requestedById: 'asker',
    ...overrides,
  }
}

describe('isInAttentionAudience', () => {
  it('asks everybody available when no skill is named', () => {
    expect(isInAttentionAudience(reviewer(), rule())).toBe(true)
  })

  it('never asks the person who raised it', () => {
    expect(isInAttentionAudience(reviewer({ id: 'asker' }), rule())).toBe(false)
  })

  it('leaves out somebody who is paused', () => {
    expect(isInAttentionAudience(reviewer({ availability: 'paused' }), rule())).toBe(false)
  })

  it('asks a reviewer whose weight is zero, because that is a routing preference', () => {
    // Weight 0 means "do not draw me automatically", which is a statement about
    // the router. Being asked directly is a different question.
    expect(isInAttentionAudience(reviewer({ weight: 0 }), rule())).toBe(true)
  })

  it('needs every named skill, not one of them', () => {
    const candidate = reviewer({ skills: ['Backend'] })
    expect(isInAttentionAudience(candidate, rule({ requiredSkills: ['Backend'] }))).toBe(true)
    expect(
      isInAttentionAudience(candidate, rule({ requiredSkills: ['Backend', 'Frontend'] })),
    ).toBe(false)
  })

  it('matches skills regardless of how they were typed', () => {
    const candidate = reviewer({ skills: ['backend'] })
    expect(isInAttentionAudience(candidate, rule({ requiredSkills: ['Backend'] }))).toBe(true)
  })

  it('keeps a same-team ask inside the team', () => {
    const gate = rule({ sameTeamOnly: true, team: 'Platform' })
    expect(isInAttentionAudience(reviewer({ team: 'platform' }), gate)).toBe(true)
    expect(isInAttentionAudience(reviewer({ team: 'Payments' }), gate)).toBe(false)
    // Nobody is in a null team, including the person who has none recorded.
    expect(isInAttentionAudience(reviewer({ team: null }), gate)).toBe(false)
  })

  it('ignores the team when the ask is open to everyone', () => {
    expect(isInAttentionAudience(reviewer({ team: 'Payments' }), rule({ team: 'Platform' }))).toBe(
      true,
    )
  })
})

describe('selectAttentionAudience', () => {
  it('keeps directory order and drops everyone the gate excludes', () => {
    const candidates = [
      reviewer({ id: 'a', skills: ['Backend'] }),
      reviewer({ id: 'b', skills: ['Frontend'] }),
      reviewer({ id: 'c', skills: ['Backend'], availability: 'paused' }),
      reviewer({ id: 'd', skills: ['Backend', 'Frontend'] }),
    ]
    const audience = selectAttentionAudience(candidates, rule({ requiredSkills: ['Backend'] }))
    expect(audience.map((r) => r.id)).toStrictEqual(['a', 'd'])
  })
})

describe('isAttentionSatisfied', () => {
  it('is answered once the critical mass has committed', () => {
    expect(isAttentionSatisfied({ neededCommitments: 2, commitments: ['x'] })).toBe(false)
    expect(isAttentionSatisfied({ neededCommitments: 2, commitments: ['x', 'y'] })).toBe(true)
  })

  it('is answered when more people committed than were asked for', () => {
    // The target can be lowered after the fact; a request stuck waiting for a
    // count it can never equal would never clear anybody's inbox.
    expect(isAttentionSatisfied({ neededCommitments: 1, commitments: ['x', 'y'] })).toBe(true)
    expect(outstandingCommitments({ neededCommitments: 1, commitments: ['x', 'y'] })).toBe(0)
  })

  it('reports how many are still wanted', () => {
    expect(outstandingCommitments({ neededCommitments: 3, commitments: ['x'] })).toBe(2)
  })
})

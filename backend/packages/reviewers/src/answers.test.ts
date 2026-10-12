import type { AttentionRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { decideCancel, decideCommit } from './answers.js'

function ask(overrides: Partial<AttentionRequest> = {}): AttentionRequest {
  return {
    id: 'a1',
    pullRequest: {
      provider: 'github',
      owner: 'o',
      repo: 'r',
      number: 1,
      url: 'https://github.com/o/r/pull/1',
    },
    title: 'Fix it',
    requestedById: 'asker',
    requestedByName: 'Asker',
    recipients: [],
    requiredSkills: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 2,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    resolvedAt: null,
    ...overrides,
  }
}

const ada = { reviewerId: 'ada', displayName: 'Ada' }

describe('decideCommit', () => {
  it('adds the commitment and keeps the ask open until enough have said yes', () => {
    const decision = decideCommit(ask(), ada, 5)
    expect(decision).toStrictEqual({
      kind: 'commit',
      resolves: false,
      patch: {
        commitments: [{ ...ada, committedAt: 5 }],
        status: 'open',
        updatedAt: 5,
        resolvedAt: null,
      },
    })
  })

  it('resolves the ask with the commitment that completes it', () => {
    const one = { reviewerId: 'bo', displayName: 'Bo', committedAt: 1 }
    const decision = decideCommit(ask({ commitments: [one] }), ada, 5)
    expect(decision).toMatchObject({
      kind: 'commit',
      resolves: true,
      patch: { status: 'resolved', resolvedAt: 5 },
    })
  })

  it('answers a second click from the same person, even on a resolved ask', () => {
    const mine = { ...ada, committedAt: 1 }
    expect(decideCommit(ask({ commitments: [mine], status: 'resolved' }), ada, 5)).toStrictEqual({
      kind: 'already',
    })
  })

  it('refuses the requester', () => {
    expect(decideCommit(ask(), { reviewerId: 'asker', displayName: 'Asker' }, 5)).toStrictEqual({
      kind: 'requester',
    })
  })

  it('refuses an ask that is no longer open', () => {
    expect(decideCommit(ask({ status: 'cancelled' }), ada, 5)).toStrictEqual({
      kind: 'closed',
      status: 'cancelled',
    })
  })
})

describe('decideCancel', () => {
  it('cancels an open ask', () => {
    expect(decideCancel(ask(), 9)).toStrictEqual({ status: 'cancelled', updatedAt: 9 })
  })

  it('leaves an ask that already ended alone', () => {
    expect(decideCancel(ask({ status: 'resolved' }), 9)).toBeNull()
  })
})

import type { AttentionRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  askedOrAnsweredIds,
  hasDeclined,
  pendingRecipientIds,
  recipientShortfall,
  withDecline,
  withoutDecline,
} from './attention.js'

function ask(overrides: Partial<AttentionRequest> = {}): AttentionRequest {
  return {
    id: 'att-1',
    pullRequest: {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number: 7,
      url: 'https://github.com/acme/api/pull/7',
    },
    title: 'Add the thing',
    requestedById: 'asker',
    requestedByName: 'Asker',
    recipients: [],
    chatDeliveries: [],
    declines: [],
    keepAsking: false,
    people: null,
    requiredSkills: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    resolvedAt: null,
    ...overrides,
  }
}

const named = (...ids: string[]) =>
  ids.map((reviewerId) => ({ reviewerId, displayName: reviewerId }))
const declined = (reviewerId: string, declinedAt = 1) => ({
  reviewerId,
  displayName: reviewerId,
  reason: null,
  declinedAt,
})
const committed = (reviewerId: string) => ({ reviewerId, displayName: reviewerId, committedAt: 1 })

describe('pendingRecipientIds', () => {
  it('keeps the named people who have neither committed nor declined', () => {
    const request = ask({
      recipients: named('ada', 'bo', 'cy'),
      commitments: [committed('ada')],
      declines: [declined('bo')],
    })
    expect(pendingRecipientIds(request)).toEqual(['cy'])
  })
})

describe('recipientShortfall', () => {
  it('is zero for an ask sent by skill, whatever has been declined', () => {
    expect(recipientShortfall(ask({ declines: [declined('ada')] }))).toBe(0)
  })

  it('is zero while enough named people are still to answer', () => {
    const request = ask({
      recipients: named('ada', 'bo', 'cy'),
      neededCommitments: 2,
      declines: [declined('ada')],
    })
    expect(recipientShortfall(request)).toBe(0)
  })

  it('counts the people a named ask still has to ask once declines leave it short', () => {
    const request = ask({
      recipients: named('ada', 'bo'),
      neededCommitments: 2,
      commitments: [committed('ada')],
      declines: [declined('bo')],
    })
    expect(recipientShortfall(request)).toBe(1)
  })

  it('is zero once the ask has what it waits for', () => {
    const request = ask({
      recipients: named('ada', 'bo'),
      commitments: [committed('ada')],
      declines: [declined('bo')],
    })
    expect(recipientShortfall(request)).toBe(0)
  })
})

describe('askedOrAnsweredIds', () => {
  it('holds the requester, every recipient, and whoever committed or declined', () => {
    const request = ask({
      recipients: named('ada'),
      commitments: [committed('volunteer')],
      declines: [declined('passer-by')],
    })
    expect([...askedOrAnsweredIds(request)].toSorted()).toEqual([
      'ada',
      'asker',
      'passer-by',
      'volunteer',
    ])
  })
})

describe('declines', () => {
  it('replaces an earlier decline from the same person instead of adding a second', () => {
    const declines = withDecline([declined('ada', 1), declined('bo', 2)], declined('ada', 3))
    expect(declines.map((entry) => [entry.reviewerId, entry.declinedAt])).toEqual([
      ['bo', 2],
      ['ada', 3],
    ])
  })

  it('drops the decline of somebody who changed their mind', () => {
    const request = ask({ declines: withoutDecline([declined('ada'), declined('bo')], 'ada') })
    expect(hasDeclined(request, 'ada')).toBe(false)
    expect(hasDeclined(request, 'bo')).toBe(true)
  })
})

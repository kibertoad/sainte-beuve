import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  askedOrAnsweredIds,
  declineRefusal,
  hasDeclined,
  withDecline,
  withoutDecline,
} from './attention.js'
import {
  askMoreChange,
  cancelChange,
  commitmentChange,
  declineChange,
  deliveriesChange,
  nextToAsk,
} from './attentionChanges.js'

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
    domains: [],
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

function person(id: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id,
    displayName: id,
    handles: { github: id, gitlab: null },
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

describe('declineRefusal', () => {
  it('lets somebody named decline though they paused since', () => {
    const request = ask({ recipients: named('ada') })
    expect(declineRefusal(request, person('ada', { availability: 'paused' }))).toBeNull()
  })

  it('refuses the requester, a committer and anybody the ask never reached', () => {
    const request = ask({ recipients: named('ada', 'bo'), commitments: [committed('bo')] })
    expect(declineRefusal(request, person('asker'))).toBe('requester')
    expect(declineRefusal(request, person('bo'))).toBe('committed')
    expect(declineRefusal(request, person('cy'))).toBe('not_addressed')
  })

  it('lets somebody who declined decline again with a new reason', () => {
    const request = ask({ recipients: named('bo'), declines: [declined('ada')] })
    expect(declineRefusal(request, person('ada'))).toBeNull()
  })
})

describe('nextToAsk', () => {
  const candidates = ['ada', 'bo', 'bo', 'cy', 'dee'].map((id) => person(id))

  it('takes candidates in order, once each, passing over everybody the ask has been to', () => {
    const request = ask({ recipients: named('ada'), declines: [declined('cy')] })
    expect(nextToAsk(request, candidates, 5).map((entry) => entry.id)).toEqual(['bo', 'dee'])
  })

  it('asks nobody on an ask that closed meanwhile', () => {
    expect(nextToAsk(ask({ status: 'cancelled' }), candidates, 1)).toEqual([])
  })

  it('stops at the most people an ask can name', () => {
    const full = named(...Array.from({ length: 10 }, (_, index) => `n${index}`))
    expect(nextToAsk(ask({ recipients: full }), candidates, 1)).toEqual([])
  })
})

describe('the changes an answer makes', () => {
  it('resolves an open ask on the commitment that completes it, and clears that decline', () => {
    const request = ask({ recipients: named('ada'), declines: [declined('ada')] })
    const patch = commitmentChange(request, committed('ada'))
    expect(patch).toMatchObject({ status: 'resolved', resolvedAt: 1, declines: [] })
  })

  it('leaves the status of an ask that closed meanwhile alone, and names no field it keeps', () => {
    const patch = commitmentChange(ask({ status: 'cancelled' }), committed('ada'))
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('declines')
  })

  it('changes nothing for a commitment already on the ask', () => {
    const first = { ...committed('ada'), committedAt: 0 }
    expect(commitmentChange(ask({ commitments: [first] }), committed('ada'))).toBeNull()
  })

  it('cancels an open ask, and leaves one that already ended alone', () => {
    expect(cancelChange(ask(), 9)).toEqual({ status: 'cancelled', updatedAt: 9 })
    expect(cancelChange(ask({ status: 'resolved' }), 9)).toBeNull()
  })

  it('asks as many as a decline leaves a keep-asking ask short, from the stored ask', () => {
    const request = ask({ recipients: named('ada', 'bo'), keepAsking: true })
    const unaffected = declineChange(request, declined('ada'), [person('cy')])
    expect(unaffected.asked).toEqual([])
    expect(unaffected.patch).not.toHaveProperty('recipients')

    const short = declineChange({ ...request, declines: [declined('bo')] }, declined('ada', 2), [
      person('cy'),
      person('dee'),
    ])
    expect(short.asked.map((entry) => entry.id)).toEqual(['cy'])
    expect(short.patch.recipients?.map((entry) => entry.reviewerId)).toEqual(['ada', 'bo', 'cy'])
    expect(short.patch.declines?.map((entry) => entry.reviewerId)).toEqual(['bo', 'ada'])
  })

  it('asks nobody on a decline when the requester did not choose to keep asking', () => {
    const change = declineChange(ask({ recipients: named('ada') }), declined('ada'), [person('cy')])
    expect(change.asked).toEqual([])
  })

  it('adds the people asked after the ones already named', () => {
    const change = askMoreChange(ask({ recipients: named('ada') }), [person('bo')], 1, 5)
    expect(change.patch).toEqual({
      updatedAt: 5,
      recipients: [
        { reviewerId: 'ada', displayName: 'ada' },
        { reviewerId: 'bo', displayName: 'bo' },
      ],
    })
  })

  it('keeps the DMs already recorded beside the new ones', () => {
    const sent = { reviewerId: 'ada', conversationId: 'D1', messageId: '1' }
    const fresh = { reviewerId: 'bo', conversationId: 'D2', messageId: '2' }
    expect(deliveriesChange(ask({ chatDeliveries: [sent] }), [fresh])).toEqual({
      chatDeliveries: [sent, fresh],
    })
  })
})

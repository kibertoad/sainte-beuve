import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { type RecipientsInput, resolveAttentionRecipients } from './recipients.js'

function reviewer(id: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id,
    displayName: `Reviewer ${id}`,
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

function input(overrides: Partial<RecipientsInput> = {}): RecipientsInput {
  return {
    directory: [reviewer('asker'), reviewer('a'), reviewer('b'), reviewer('author')],
    requestedById: 'asker',
    recipientIds: ['a'],
    neededCommitments: 1,
    authorIds: ['author'],
    ...overrides,
  }
}

describe('resolveAttentionRecipients', () => {
  it('names nobody when the requester named nobody, whatever the ask waits for', () => {
    expect(resolveAttentionRecipients(input({ recipientIds: [], neededCommitments: 3 }))).toEqual({
      ok: true,
      reviewers: [],
    })
  })

  it('keeps the names in the order given, a repeated one once, as their directory entries', () => {
    const resolution = resolveAttentionRecipients(input({ recipientIds: ['b', 'a', 'b'] }))
    expect(resolution).toEqual({ ok: true, reviewers: [reviewer('b'), reviewer('a')] })
  })

  it('refuses waiting for more people than it names, counting a repeat once', () => {
    const resolution = resolveAttentionRecipients(
      input({ recipientIds: ['a', 'a'], neededCommitments: 2 }),
    )
    expect(resolution).toEqual({ ok: false, refusal: { reason: 'too_few', named: 1 } })
  })

  it('refuses a name the directory does not hold', () => {
    const resolution = resolveAttentionRecipients(input({ recipientIds: ['ghost'] }))
    expect(resolution).toEqual({ ok: false, refusal: { reason: 'unknown', reviewerId: 'ghost' } })
  })

  it('refuses the requester, somebody paused and the author, as delivery would drop them', () => {
    const paused = reviewer('p', { availability: 'paused' })
    const reasons = ['asker', 'p', 'author'].map((id) => {
      const resolution = resolveAttentionRecipients(
        input({ directory: [...input().directory, paused], recipientIds: [id] }),
      )
      return resolution.ok ? null : resolution.refusal.reason
    })
    expect(reasons).toStrictEqual(['requester', 'paused', 'author'])
  })
})

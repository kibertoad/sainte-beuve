import { describe, expect, it } from 'vitest'
import { type ChatCommandInput, decideChatCommand } from './commands.js'

const MEMBER = { id: 'rev-1', role: 'member', availability: 'available' } as const
const HELD_BY_OTHER = { assignedReviewerIds: ['rev-2'] }

function decide(overrides: Partial<ChatCommandInput>) {
  return decideChatCommand({ verb: 'claim', actor: MEMBER, review: HELD_BY_OTHER, ...overrides })
}

describe('decideChatCommand', () => {
  it('changes nothing for somebody the directory does not hold', () => {
    for (const verb of ['claim', 'snooze', 'reroll', 'ai_review'] as const) {
      expect(decide({ verb, actor: null })).toStrictEqual({
        allowed: false,
        reason: 'not_in_directory',
      })
    }
  })

  it('changes nothing for somebody paused', () => {
    expect(decide({ actor: { ...MEMBER, availability: 'paused' } })).toStrictEqual({
      allowed: false,
      reason: 'paused',
    })
  })

  it('lets a member take, snooze or file an AI review on any review', () => {
    for (const verb of ['claim', 'snooze', 'ai_review'] as const) {
      expect(decide({ verb })).toMatchObject({ allowed: true })
    }
  })

  it('lets a reroll come only from whoever holds the review, or an admin', () => {
    expect(decide({ verb: 'reroll' })).toStrictEqual({ allowed: false, reason: 'not_the_holder' })
    expect(decide({ verb: 'reroll', review: { assignedReviewerIds: ['rev-1'] } })).toStrictEqual({
      allowed: true,
      actor: MEMBER,
    })
    expect(decide({ verb: 'reroll', actor: { ...MEMBER, role: 'admin' } })).toMatchObject({
      allowed: true,
    })
  })
})

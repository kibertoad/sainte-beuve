import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { attentionRequestSchema, createAttentionRequestSchema } from './attention.js'

const pullRequest = {
  provider: 'github',
  owner: 'acme',
  repo: 'web',
  number: 1,
  url: 'https://github.com/acme/web/pull/1',
}

describe('attentionRequestSchema', () => {
  it('reads a request stored before recipients existed as a gated one', () => {
    const parsed = v.parse(attentionRequestSchema, {
      id: 'a1',
      pullRequest,
      title: 'Look at this',
      requestedById: 'r1',
      requestedByName: 'One',
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
    })
    expect(parsed.recipients).toStrictEqual([])
  })
})

describe('createAttentionRequestSchema', () => {
  it('asks nobody by name unless the caller names somebody', () => {
    const parsed = v.parse(createAttentionRequestSchema, { pullRequest, title: 'Look' })
    expect(parsed.recipientIds).toStrictEqual([])
  })

  it('refuses more names than one ask can carry', () => {
    const recipientIds = Array.from({ length: 11 }, (_, i) => `r${i}`)
    const result = v.safeParse(createAttentionRequestSchema, {
      pullRequest,
      title: 'Look',
      recipientIds,
    })
    expect(result.success).toBe(false)
  })
})

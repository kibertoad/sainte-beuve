import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { isBotLogin } from './dependencyBots.js'
import { planReviewerSuggestions, type ReviewerSuggestionsInput } from './reviewerSuggestions.js'

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

/** Only the fields the plan reads. */
function ask(fields: Partial<AttentionRequest>): AttentionRequest {
  return {
    requestedById: 'author',
    recipients: [],
    commitments: [],
    declines: [],
    ...fields,
  } as AttentionRequest
}

const DIRECTORY = ['author', 'ann', 'bob', 'cat', 'dan', 'eve'].map((id) => reviewer({ id }))

function plan(input: Partial<ReviewerSuggestionsInput<{ reviewer: Reviewer }>> = {}) {
  return planReviewerSuggestions({
    ranked: DIRECTORY.filter((entry) => entry.id !== 'author').map((entry) => ({
      reviewer: entry,
    })),
    directory: DIRECTORY,
    provider: 'github',
    requestedById: 'author',
    authorIds: ['author'],
    committedIds: [],
    requestedIds: [],
    asks: [],
    limit: 3,
    wanted: 2,
    ...input,
  })
}

function ids(entries: readonly { reviewer: Reviewer }[]): string[] {
  return entries.map((entry) => entry.reviewer.id)
}

describe('planReviewerSuggestions', () => {
  it('offers the best matches with the top ones ticked and everybody else to search', () => {
    const result = plan()

    expect(ids(result.candidates)).toStrictEqual(['ann', 'bob', 'cat'])
    expect(result.preselectedIds).toStrictEqual(['ann', 'bob'])
    expect(result.others.map((entry) => entry.id)).toStrictEqual(['dan', 'eve'])
    expect(result.involved).toStrictEqual([])
  })

  it('shows the people already on it instead of offering them, and ticks fewer', () => {
    const result = plan({
      committedIds: ['ann'],
      requestedIds: ['dan'],
      asks: [
        ask({
          recipients: [
            { reviewerId: 'bob', displayName: 'bob' },
            { reviewerId: 'eve', displayName: 'eve' },
          ],
          declines: [{ reviewerId: 'eve', displayName: 'eve', reason: null, declinedAt: 0 }],
        }),
      ],
    })

    expect(ids(result.candidates)).toStrictEqual(['cat'])
    expect(result.preselectedIds).toStrictEqual([])
    expect(result.others).toStrictEqual([])
    expect(result.involved.map(({ reviewer: entry, state }) => [entry.id, state])).toStrictEqual([
      ['ann', 'committed'],
      ['bob', 'asked'],
      ['dan', 'requested'],
      ['eve', 'declined'],
    ])
  })

  it('counts a commitment made on an ask as committed', () => {
    const result = plan({
      asks: [
        ask({
          recipients: [{ reviewerId: 'ann', displayName: 'ann' }],
          commitments: [{ reviewerId: 'ann', displayName: 'ann', committedAt: 0 }],
        }),
      ],
    })

    expect(result.involved.map(({ state }) => state)).toStrictEqual(['committed'])
    expect(result.preselectedIds).toStrictEqual(['bob'])
  })

  it('never offers a bot, a paused person, or the author', () => {
    const directory = [
      reviewer({ id: 'author' }),
      reviewer({ id: 'renovate', handles: { github: 'renovate[bot]', gitlab: null } }),
      reviewer({ id: 'away', availability: 'paused' }),
      reviewer({ id: 'cowriter' }),
      reviewer({ id: 'ann' }),
    ]
    const result = plan({
      directory,
      ranked: directory.map((entry) => ({ reviewer: entry })),
      authorIds: ['author', 'cowriter'],
    })

    expect(ids(result.candidates)).toStrictEqual(['ann'])
    expect(result.others).toStrictEqual([])
  })
})

describe('isBotLogin', () => {
  it('knows a GitHub App and a dependency bot, and nobody else', () => {
    expect(isBotLogin('sainte-beuve[bot]')).toBe(true)
    expect(isBotLogin('renovate')).toBe(true)
    expect(isBotLogin('ada')).toBe(false)
  })
})

import type { Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { pastReviewCounts } from './history.js'

function reviewer(id: string, handles: Reviewer['handles']): Reviewer {
  return {
    id,
    displayName: id,
    handles,
    slackUserId: null,
    team: null,
    skills: [],
    domains: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: 0,
  }
}

const ann = reviewer('ann-id', { github: 'Ann', gitlab: 'ann-gl' })
const bea = reviewer('bea-id', { github: 'bea', gitlab: null })
const cid = reviewer('cid-id', { github: null, gitlab: 'cid' })

describe('pastReviewCounts', () => {
  it('credits the host tallies to whoever holds the handle on that host', () => {
    const counts = pastReviewCounts(
      {
        board: [],
        host: [
          { login: 'ann', reviews: 4 },
          { login: 'cid', reviews: 2 },
          { login: 'stranger', reviews: 9 },
        ],
      },
      [ann, bea, cid],
      'github',
    )
    expect([...counts]).toStrictEqual([['ann-id', 4]])
  })

  it('takes the larger of the two counts, because they describe one history', () => {
    const counts = pastReviewCounts(
      {
        board: [
          { status: 'approved', assignedReviewerIds: ['ann-id', 'bea-id'] },
          { status: 'approved', assignedReviewerIds: ['bea-id'] },
          { status: 'changes_requested', assignedReviewerIds: ['bea-id'] },
        ],
        host: [
          { login: 'ann', reviews: 5 },
          { login: 'bea', reviews: 1 },
        ],
      },
      [ann, bea],
      'github',
    )
    expect(counts.get('ann-id')).toBe(5)
    expect(counts.get('bea-id')).toBe(3)
  })

  it('stands on the board alone when the host had nothing to say', () => {
    const counts = pastReviewCounts(
      { board: [{ status: 'approved', assignedReviewerIds: ['cid-id'] }], host: [] },
      [ann, cid],
      'gitlab',
    )
    expect([...counts]).toStrictEqual([['cid-id', 1]])
  })
})

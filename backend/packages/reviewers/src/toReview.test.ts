import type { OpenPullRequest, Project, Reviewer, ReviewCommitment } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  FIT_WEIGHT,
  NEGLECT_WEIGHT,
  type OpenReviews,
  type RepositoryToReview,
  rankPullRequestsToReview,
  scoreOf,
  UNREVIEWED_HALF_POINT_MS,
} from './toReview.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

const VIEWER: Reviewer = {
  id: 'viewer',
  displayName: 'Viewer',
  handles: { github: 'kibertoad', gitlab: null },
  slackUserId: null,
  team: null,
  skills: ['Backend'],
  domains: ['billing'],
  availability: 'available',
  role: 'member',
  weight: 1,
  outstandingReviews: 0,
  createdAt: 0,
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    provider: 'github',
    owner: 'acme',
    repo: 'api',
    webUrl: null,
    skills: ['backend', 'frontend'],
    domains: ['billing', 'search'],
    mergeComments: null,
    restrictDirectMerge: false,
    createdAt: 0,
    ...overrides,
  }
}

function pr(number: number, overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    pullRequest: {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number,
      url: `https://github.com/acme/api/pull/${number}`,
    },
    title: `Change ${number}`,
    authorLogin: 'peer',
    requestedReviewerLogins: [],
    draft: false,
    createdAt: NOW - DAY,
    updatedAt: NOW,
    ...overrides,
  }
}

function repository(overrides: Partial<RepositoryToReview> = {}): RepositoryToReview {
  const pullRequests = overrides.pullRequests ?? [pr(1)]
  return {
    project: project(),
    pullRequests,
    reviews: new Map(pullRequests.map((row) => [row.pullRequest.number, reviewed()])),
    pastReviews: 0,
    authored: 0,
    ...overrides,
  }
}

function reviewed(reviewerLogins: string[] = [], awaitingLogins: string[] = []): OpenReviews {
  return { reviewerLogins, awaitingLogins }
}

function commitment(number: number, reviewerId: string, createdAt = NOW): ReviewCommitment {
  return {
    id: `${reviewerId}-${number}`,
    reviewerId,
    pullRequest: pr(number).pullRequest,
    title: `Change ${number}`,
    attentionRequestId: null,
    requestedHandle: null,
    createdAt,
  }
}

function rank(repositories: RepositoryToReview[], commitments: ReviewCommitment[] = []) {
  return rankPullRequestsToReview({
    viewer: VIEWER,
    repositories,
    commitments,
    now: NOW,
    limit: 50,
  })
}

function numbers(rows: ReturnType<typeof rank>): number[] {
  return rows.map((row) => row.pullRequest.number)
}

describe('rankPullRequestsToReview', () => {
  it('puts what the viewer committed to first, oldest promise first', () => {
    const rows = rank(
      [repository({ pullRequests: [pr(1, { createdAt: NOW - 30 * DAY }), pr(2), pr(3)] })],
      [commitment(2, 'viewer', NOW - DAY), commitment(3, 'viewer', NOW - 2 * DAY)],
    )
    expect(numbers(rows)).toStrictEqual([3, 2, 1])
    expect(rows[0]?.reasons.committedAt).toBe(NOW - 2 * DAY)
  })

  it('ranks the pull request unreviewed for longest higher', () => {
    const rows = rank([
      repository({
        pullRequests: [pr(1, { createdAt: NOW - DAY }), pr(2, { createdAt: NOW - 5 * DAY })],
      }),
    ])
    expect(numbers(rows)).toStrictEqual([2, 1])
    expect(rows[0]?.reasons.unreviewedForMs).toBe(5 * DAY)
  })

  it('prefers an unreviewed pull request nobody committed to', () => {
    const rows = rank([repository({ pullRequests: [pr(1), pr(2)] })], [commitment(1, 'other')])
    expect(numbers(rows)).toStrictEqual([2, 1])
    expect(rows[1]?.reasons.othersCommitted).toBe(1)
  })

  it('stops counting the wait once somebody reviewed it', () => {
    const old = pr(1, { createdAt: NOW - 30 * DAY })
    const rows = rank([
      repository({
        pullRequests: [old, pr(2)],
        reviews: new Map([
          [1, reviewed(['alice'])],
          [2, reviewed()],
        ]),
      }),
    ])
    expect(numbers(rows)).toStrictEqual([2, 1])
    expect(rows[1]?.reasons).toMatchObject({ unreviewedForMs: null, reviewerLogins: ['alice'] })
  })

  it('does not call a pull request unreviewed when its reviews were not read', () => {
    const rows = rank([repository({ reviews: new Map() })])
    expect(rows[0]?.reasons).toMatchObject({ unreviewedForMs: null, reviewerLogins: [] })
  })

  it('raises the repositories the viewer fits and has worked in', () => {
    const elsewhere = repository({
      project: project({ id: 'p2', repo: 'web', skills: ['ios'], domains: [] }),
      pullRequests: [pr(1, { pullRequest: { ...pr(1).pullRequest, repo: 'web' } })],
    })
    const home = repository({ pullRequests: [pr(2)], pastReviews: 4, authored: 2 })
    const rows = rank([elsewhere, home])
    expect(numbers(rows)).toStrictEqual([2, 1])
    expect(rows[0]?.reasons).toMatchObject({
      matchedSkills: ['backend'],
      matchedDomains: ['billing'],
      fit: 0.5,
      pastReviews: 4,
      authored: 2,
    })
  })

  it('leaves out drafts, the viewer’s own, and what the viewer already reviewed', () => {
    const rows = rank([
      repository({
        pullRequests: [
          pr(1, { draft: true }),
          pr(2, { authorLogin: 'Kibertoad' }),
          pr(3),
          pr(4, { requestedReviewerLogins: ['kibertoad'] }),
          pr(5),
        ],
        reviews: new Map([
          [3, reviewed(['kibertoad'])],
          [4, reviewed(['kibertoad'], ['kibertoad'])],
          [5, reviewed()],
        ]),
      }),
    ])
    expect(numbers(rows).sort()).toStrictEqual([4, 5])
    expect(rows.find((row) => row.pullRequest.number === 4)?.reasons.requested).toBe(true)
  })

  it('takes who the host is waiting on from the reviews, not the listing', () => {
    // GitLab keeps a reviewer listed after they approve.
    const listed = { requestedReviewerLogins: ['kibertoad'] }
    const rows = rank([
      repository({
        pullRequests: [pr(1, listed), pr(2, listed), pr(3)],
        reviews: new Map([
          [1, reviewed(['kibertoad'])],
          [2, reviewed([], [])],
          [3, reviewed([], ['kibertoad'])],
        ]),
      }),
    ])
    expect(numbers(rows).sort()).toStrictEqual([2, 3])
    expect(rows.find((row) => row.pullRequest.number === 2)?.reasons.requested).toBe(false)
    expect(rows.find((row) => row.pullRequest.number === 3)?.reasons.requested).toBe(true)
  })

  it('falls back to the listing for who is asked when the reviews were not read', () => {
    const rows = rank([
      repository({
        pullRequests: [pr(1, { requestedReviewerLogins: ['kibertoad'] })],
        reviews: new Map(),
      }),
    ])
    expect(rows[0]?.reasons.requested).toBe(true)
  })

  it('matches commitments on the host and the path in any case', () => {
    const gitlab = {
      ...commitment(1, 'viewer'),
      pullRequest: { ...pr(1).pullRequest, provider: 'gitlab' as const },
    }
    const shouted = {
      ...commitment(2, 'viewer'),
      pullRequest: { ...pr(2).pullRequest, owner: 'ACME' },
    }
    const rows = rank([repository({ pullRequests: [pr(1), pr(2)] })], [gitlab, shouted])
    expect(rows.map((row) => row.reasons.committedAt !== null)).toStrictEqual([true, false])
    expect(numbers(rows)).toStrictEqual([2, 1])
  })

  it('stops at the limit', () => {
    const rows = rankPullRequestsToReview({
      viewer: VIEWER,
      repositories: [repository({ pullRequests: [pr(1), pr(2), pr(3)] })],
      commitments: [],
      now: NOW,
      limit: 2,
    })
    expect(rows).toHaveLength(2)
  })
})

describe('scoreOf', () => {
  const none = {
    committedAt: null,
    requested: false,
    othersCommitted: 0,
    reviewerLogins: [],
    unreviewedForMs: null,
    matchedSkills: [],
    matchedDomains: [],
    fit: 0,
    pastReviews: 0,
    authored: 0,
  }

  it('earns half the neglect at the half point, and half again when somebody committed', () => {
    const waited = { ...none, unreviewedForMs: UNREVIEWED_HALF_POINT_MS }
    expect(scoreOf(waited)).toBeCloseTo(NEGLECT_WEIGHT / 2)
    expect(scoreOf({ ...waited, othersCommitted: 2 })).toBeCloseTo(NEGLECT_WEIGHT / 4)
  })

  it('lets a long wait outweigh a whole fit', () => {
    const neglected = scoreOf({ ...none, unreviewedForMs: 5 * DAY })
    const fitting = scoreOf({ ...none, unreviewedForMs: 0, fit: 1 })
    expect(fitting).toBe(FIT_WEIGHT)
    expect(neglected).toBeGreaterThan(fitting)
  })
})

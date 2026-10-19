import type {
  AttentionRequest,
  OpenPullRequest,
  Project,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { assembleReviewLists, placeCommitments, type ReviewListsInput } from './reviewing.js'

function pr(repo: string, number: number, owner = 'acme'): OpenPullRequest {
  return {
    pullRequest: {
      provider: 'github',
      owner,
      repo,
      number,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    },
    title: 'A change',
    authorLogin: 'bob',
    requestedReviewerLogins: [],
    draft: false,
    createdAt: 0,
    updatedAt: number,
  }
}

const API: Project = {
  id: 'p-api',
  provider: 'github',
  owner: 'Acme',
  repo: 'API',
  webUrl: null,
  skills: [],
  domains: [],
  mergeComments: null,
  restrictDirectMerge: false,
  createdAt: 0,
}

const VIEWER = 'r-viewer'

function askOn(open: OpenPullRequest, overrides: Partial<AttentionRequest> = {}): AttentionRequest {
  return {
    id: `ask-${open.pullRequest.number}`,
    pullRequest: open.pullRequest,
    title: 'Asked change',
    requestedById: 'r-asker',
    requestedByName: 'Asker',
    recipients: [{ reviewerId: VIEWER, displayName: 'Viewer' }],
    chatDeliveries: [],
    declines: [],
    keepAsking: false,
    people: { authorLogin: 'carol', requestedReviewerLogins: [] },
    requiredSkills: [],
    domains: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 0,
    updatedAt: 10,
    resolvedAt: null,
    ...overrides,
  }
}

function input(overrides: Partial<ReviewListsInput>): ReviewListsInput {
  return {
    requestedInProjects: [],
    requestedFound: [],
    reviewedFound: [],
    commitments: [],
    projects: [API],
    openInProjects: [],
    asks: [],
    viewerId: VIEWER,
    ...overrides,
  }
}

function commitmentOn(open: OpenPullRequest): ReviewCommitment {
  return {
    id: 'c1',
    reviewerId: 'r1',
    pullRequest: open.pullRequest,
    title: 'A change',
    attentionRequestId: null,
    requestedHandle: null,
    createdAt: 0,
  }
}

const numbers = (rows: { pullRequest: { number: number } }[]) =>
  rows.map((row) => row.pullRequest.number)

describe('assembleReviewLists', () => {
  it('keeps a request found both ways once, placed in its project, newest first', () => {
    const lists = assembleReviewLists(
      input({ requestedInProjects: [pr('api', 1)], requestedFound: [pr('api', 1), pr('web', 2)] }),
      {},
    )
    expect(lists.requested.map((row) => [row.pullRequest.number, row.projectId])).toStrictEqual([
      [2, null],
      [1, 'p-api'],
    ])
  })

  it('moves a pull request asked about again from reviewed to requested', () => {
    const lists = assembleReviewLists(
      input({ requestedFound: [pr('api', 1)], reviewedFound: [pr('api', 1), pr('api', 3)] }),
      {},
    )
    expect(numbers(lists.requested)).toStrictEqual([1])
    expect(numbers(lists.reviewed)).toStrictEqual([3])
  })

  it('lists a pull request committed to under committed alone', () => {
    // The commitment put the request on the host, so the host search finds it too.
    const lists = assembleReviewLists(
      input({
        requestedFound: [pr('api', 1), pr('api', 2)],
        commitments: [commitmentOn(pr('api', 1))],
      }),
      {},
    )
    expect(numbers(lists.requested)).toStrictEqual([2])
    expect(numbers(lists.committed)).toStrictEqual([1])
  })

  it('keeps to the linked repositories and the owner on request', () => {
    const commitment = commitmentOn(pr('web', 4))
    const found = input({
      requestedFound: [pr('api', 1), pr('web', 2), pr('cli', 5, 'other')],
      commitments: [commitment],
    })

    const linked = assembleReviewLists(found, { scope: 'linked' })
    expect(numbers(linked.requested)).toStrictEqual([1])
    expect(linked.committed).toStrictEqual([])

    const byOwner = assembleReviewLists(found, { owner: 'ACME' })
    expect(numbers(byOwner.requested)).toStrictEqual([2, 1])
    expect(byOwner.committed).toMatchObject([{ id: 'c1', projectId: null }])
  })

  it('leaves out Dependabot and Renovate pull requests unless asked to show them', () => {
    const bot = (number: number, authorLogin: string) => ({ ...pr('api', number), authorLogin })
    const found = input({
      requestedFound: [pr('api', 1), bot(2, 'dependabot[bot]')],
      reviewedFound: [pr('api', 3), bot(4, 'renovate[bot]')],
      commitments: [commitmentOn(bot(5, 'renovate[bot]'))],
    })

    const hidden = assembleReviewLists(found, {})
    expect(numbers(hidden.requested)).toStrictEqual([1])
    expect(numbers(hidden.reviewed)).toStrictEqual([3])
    expect(numbers(hidden.committed)).toStrictEqual([5])

    const shown = assembleReviewLists(found, { dependencyBots: 'show' })
    expect(numbers(shown.requested)).toStrictEqual([2, 1])
    expect(numbers(shown.reviewed)).toStrictEqual([4, 3])
  })
})

describe('assembleReviewLists with asks', () => {
  it('lists an ask naming the viewer once, beside the host request for the same pull request', () => {
    const lists = assembleReviewLists(
      input({
        requestedFound: [pr('api', 1)],
        openInProjects: [pr('api', 2)],
        asks: [askOn(pr('api', 1)), askOn(pr('api', 2)), askOn(pr('web', 3))],
      }),
      {},
    )
    expect(
      lists.requested.map((row) => [row.pullRequest.number, row.authorLogin, row.ask?.attentionId]),
    ).toStrictEqual([
      [3, 'carol', 'ask-3'],
      [2, 'bob', 'ask-2'],
      [1, 'bob', 'ask-1'],
    ])
  })

  it('leaves out asks the viewer answered, was not named on, or that are closed', () => {
    const answered = { reviewerId: VIEWER, displayName: 'Viewer' }
    const lists = assembleReviewLists(
      input({
        asks: [
          askOn(pr('api', 1), { commitments: [{ ...answered, committedAt: 1 }] }),
          askOn(pr('api', 2), { declines: [{ ...answered, reason: null, declinedAt: 1 }] }),
          askOn(pr('api', 3), { recipients: [{ reviewerId: 'r-other', displayName: 'Other' }] }),
          askOn(pr('api', 4), { status: 'resolved' }),
        ],
      }),
      {},
    )
    expect(lists.requested).toStrictEqual([])
  })

  it('moves an asked pull request out of reviewed and keeps a committed one under committed', () => {
    const lists = assembleReviewLists(
      input({
        reviewedFound: [pr('api', 1)],
        commitments: [commitmentOn(pr('api', 2))],
        asks: [askOn(pr('api', 1)), askOn(pr('api', 2))],
      }),
      {},
    )
    expect(numbers(lists.requested)).toStrictEqual([1])
    expect(lists.reviewed).toStrictEqual([])
    expect(numbers(lists.committed)).toStrictEqual([2])
  })
})

describe('placeCommitments', () => {
  it('names the registered project whatever the case of its owner and name', () => {
    const commitment = (id: string, repo: string) => ({ ...commitmentOn(pr(repo, 4)), id })

    const placed = placeCommitments([commitment('c1', 'api'), commitment('c2', 'web')], [API])

    expect(placed).toMatchObject([
      { id: 'c1', projectId: 'p-api' },
      { id: 'c2', projectId: null },
    ])
  })
})

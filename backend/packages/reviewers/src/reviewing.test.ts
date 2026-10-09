import type { OpenPullRequest, Project, ReviewCommitment } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { assembleReviewLists, type ReviewListsInput } from './reviewing.js'

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

function input(overrides: Partial<ReviewListsInput>): ReviewListsInput {
  return {
    requestedInProjects: [],
    requestedFound: [],
    reviewedFound: [],
    commitments: [],
    projects: [API],
    ...overrides,
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

  it('keeps to the linked repositories and the owner on request', () => {
    const commitment: ReviewCommitment = {
      id: 'c1',
      reviewerId: 'r1',
      pullRequest: pr('web', 4).pullRequest,
      title: 'A change',
      attentionRequestId: null,
      createdAt: 0,
    }
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
})

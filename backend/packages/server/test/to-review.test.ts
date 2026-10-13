import type { OpenPullRequest, PullRequestsToReview } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  buildHarness,
  environmentVcs,
  get,
  openPullRequest,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// PRs to review through the app. The ranking is tested purely in
// @sainte-beuve/reviewers; this suite covers the sweep, the host's review and
// history reads, and the commitments coming together.

const HOUR = 60 * 60 * 1000

function pr(number: number, repo: string, overrides: Partial<OpenPullRequest> = {}) {
  return openPullRequest({
    authorLogin: 'bob',
    ...overrides,
    pullRequest: {
      provider: 'github',
      owner: 'acme',
      repo,
      number,
      url: `https://github.com/acme/${repo}/pull/${number}`,
    },
  })
}

async function addProject(harness: TestHarness, repo: string): Promise<void> {
  const res = await harness.app.fetch(
    post('/api/v1/projects', { provider: 'github', owner: 'acme', repo }),
  )
  expect(res.status).toBe(201)
}

async function list(harness: TestHarness): Promise<PullRequestsToReview> {
  const res = await harness.app.fetch(get('/api/v1/to-review'))
  expect(res.status).toBe(200)
  return (await res.json()) as PullRequestsToReview
}

const numbers = (view: PullRequestsToReview) =>
  view.pullRequests.map((row) => row.pullRequest.number)

function vcsWith(pulls: OpenPullRequest[], overrides: Partial<VcsGateway>): VcsGateway {
  return { ...viewerVcs('ada', pulls), ...overrides }
}

describe('PRs to review', () => {
  it('leads with my promises, then the longest unreviewed nobody took', async () => {
    const now = 1_000_000 * HOUR
    const pulls = [
      pr(1, 'api', { createdAt: now - 2 * HOUR }),
      pr(2, 'api', { createdAt: now - 48 * HOUR }),
      pr(3, 'api', { createdAt: now - 72 * HOUR }),
      pr(4, 'api', { createdAt: now - HOUR }),
      pr(5, 'api', { authorLogin: 'ada' }),
      pr(6, 'api', { draft: true }),
      pr(7, 'web'),
    ]
    const harness = buildHarness({
      vcs: environmentVcs(
        vcsWith(pulls, {
          openPullRequestReviews: async (project) =>
            project.repo === 'api'
              ? [
                  { number: 1, reviewerLogins: [], awaitingLogins: [] },
                  { number: 2, reviewerLogins: [], awaitingLogins: [] },
                  { number: 3, reviewerLogins: ['carol'], awaitingLogins: [] },
                  { number: 4, reviewerLogins: [], awaitingLogins: [] },
                ]
              : [],
          pastActivity: async () => ({
            reviewers: [{ login: 'Ada', reviews: 2 }],
            authors: [{ login: 'ada', pullRequests: 1 }],
          }),
        }),
      ),
    })
    harness.clock.advance(now - harness.clock.now())
    await addProject(harness, 'api')
    await harness.app.fetch(
      post('/api/v1/commitments', { pullRequest: pr(4, 'api').pullRequest, title: 'Mine' }),
    )

    const view = await list(harness)
    expect(numbers(view)).toStrictEqual([4, 2, 1, 3])
    const [mine, waiting, , reviewed] = view.pullRequests
    expect(mine?.reasons.committedAt).toBe(now)
    expect(waiting?.reasons).toMatchObject({
      unreviewedForMs: 48 * HOUR,
      othersCommitted: 0,
      pastReviews: 2,
      authored: 1,
    })
    expect(reviewed?.reasons).toMatchObject({ unreviewedForMs: null, reviewerLogins: ['carol'] })
    expect(view.sources).toHaveLength(1)
  })

  it('still lists the pull requests when the host will not say who reviewed them', async () => {
    const vcs = vcsWith([pr(1, 'api')], {
      openPullRequestReviews: () => Promise.reject(new Error('rate limited')),
      pastActivity: () => Promise.reject(new Error('rate limited')),
    })
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    await addProject(harness, 'api')

    const view = await list(harness)
    expect(numbers(view)).toStrictEqual([1])
    expect(view.pullRequests[0]?.reasons).toMatchObject({
      unreviewedForMs: null,
      pastReviews: 0,
      authored: 0,
    })
  })

  it('counts the commitments other people made', async () => {
    const harness = buildHarness({ vcs: environmentVcs(vcsWith([pr(1, 'api')], {})) })
    await addProject(harness, 'api')
    await harness.container.repositories.commitments.createOrGet({
      id: 'theirs',
      reviewerId: 'somebody-else',
      pullRequest: pr(1, 'api').pullRequest,
      title: 'Theirs',
      attentionRequestId: null,
      requestedHandle: null,
      createdAt: 0,
    })

    const view = await list(harness)
    expect(view.pullRequests[0]?.reasons).toMatchObject({ committedAt: null, othersCommitted: 1 })
  })
})

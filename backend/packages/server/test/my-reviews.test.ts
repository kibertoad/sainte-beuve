import type { MyReviews, OpenPullRequest, Project } from '@sainte-beuve/contracts'
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

// My Reviews through the app. How the three lists are cut is tested purely in
// @sainte-beuve/reviewers; this suite covers the sweep, the search and the
// commitments coming together.

const MINE = '/api/v1/my-reviews'

function pr(number: number, repo: string, overrides: Partial<OpenPullRequest> = {}) {
  return openPullRequest({
    authorLogin: 'bob',
    updatedAt: number,
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

async function addProject(harness: TestHarness, repo: string): Promise<Project> {
  const res = await harness.app.fetch(
    post('/api/v1/projects', { provider: 'github', owner: 'acme', repo }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

async function list(harness: TestHarness, query = ''): Promise<MyReviews> {
  const res = await harness.app.fetch(get(`${MINE}${query}`))
  expect(res.status).toBe(200)
  return (await res.json()) as MyReviews
}

const rows = (items: { pullRequest: { number: number }; projectId: string | null }[]) =>
  items.map((row) => [row.pullRequest.number, row.projectId])

describe('My Reviews', () => {
  it('lists what I was asked to review, committed to, and reviewed, linked or not', async () => {
    const pulls = [
      pr(1, 'api', { requestedReviewerLogins: ['ada'] }),
      pr(2, 'web', { requestedReviewerLogins: ['ada'] }),
      pr(3, 'web'),
      pr(4, 'web', { authorLogin: 'ada' }),
    ]
    const harness = buildHarness({ vcs: environmentVcs(viewerVcs('ada', pulls, {}, [3, 4])) })
    const api = await addProject(harness, 'api')
    await harness.app.fetch(
      post('/api/v1/commitments', { pullRequest: pr(5, 'api').pullRequest, title: 'Later' }),
    )

    const view = await list(harness)
    expect(rows(view.requested)).toStrictEqual([
      [2, null],
      [1, api.id],
    ])
    expect(rows(view.reviewed)).toStrictEqual([[3, null]])
    expect(rows(view.committed)).toStrictEqual([[5, api.id]])
    expect(view.searches).toStrictEqual([{ provider: 'github', ok: true, reason: null }])

    const linked = await list(harness, '?scope=linked')
    expect(rows(linked.requested)).toStrictEqual([[1, api.id]])
    expect(linked.reviewed).toStrictEqual([])
  })

  it('still lists the linked review requests when the host refuses the search', async () => {
    const vcs = viewerVcs('ada', [pr(1, 'api', { requestedReviewerLogins: ['ada'] })])
    const refusing = {
      ...vcs,
      searchOpenPullRequests: () => Promise.reject(new Error('rate limited')),
    }
    const harness = buildHarness({ vcs: environmentVcs(refusing) })
    await addProject(harness, 'api')

    const view = await list(harness)
    expect(view.requested.map((row) => row.pullRequest.number)).toStrictEqual([1])
    expect(view.searches).toStrictEqual([{ provider: 'github', ok: false, reason: 'rate limited' }])
  })
})

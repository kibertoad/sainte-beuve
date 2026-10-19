import type { AttentionRequest, MyReviews, OpenPullRequest, Project } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  addReviewer,
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

  it('hides Dependabot and Renovate pull requests unless asked to show them', async () => {
    const pulls = [
      pr(1, 'api', { requestedReviewerLogins: ['ada'] }),
      pr(2, 'api', { requestedReviewerLogins: ['ada'], authorLogin: 'dependabot[bot]' }),
      pr(3, 'web', { authorLogin: 'renovate[bot]' }),
    ]
    const harness = buildHarness({ vcs: environmentVcs(viewerVcs('ada', pulls, {}, [3])) })
    await addProject(harness, 'api')

    const hidden = await list(harness)
    expect(hidden.requested.map((row) => row.pullRequest.number)).toStrictEqual([1])
    expect(hidden.reviewed).toStrictEqual([])

    const shown = await list(harness, '?dependencyBots=show')
    expect(shown.requested.map((row) => row.pullRequest.number)).toStrictEqual([2, 1])
    expect(shown.reviewed.map((row) => row.pullRequest.number)).toStrictEqual([3])
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

  it('lists a teammate ask naming me once per pull request, until I answer it', async () => {
    const pulls = [pr(1, 'api', { requestedReviewerLogins: ['ada'] }), pr(2, 'api')]
    const asker = buildHarness({ vcs: environmentVcs(viewerVcs('kibertoad', pulls)) })
    await addProject(asker, 'api')
    await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    const ada = await addReviewer(asker, { displayName: 'Ada', handles: { github: 'ada' } })
    const bo = await addReviewer(asker, { displayName: 'Bo', handles: { github: 'bo' } })
    const raise = async (open: OpenPullRequest, neededCommitments = 1) => {
      const res = await asker.app.fetch(
        post('/api/v1/attention', {
          pullRequest: open.pullRequest,
          title: open.title,
          recipientIds: [ada.id, bo.id],
          neededCommitments,
          note: 'Touches billing',
        }),
      )
      expect(res.status).toBe(201)
      return (await res.json()) as AttentionRequest
    }
    const both = await raise(pulls[0]!)
    const askedOnly = await raise(pulls[1]!)
    const declined = await raise(pr(3, 'web'))
    const committed = await raise(pr(4, 'web'), 2)
    const harness = buildHarness({
      ...asker.container,
      vcs: environmentVcs(viewerVcs('ada', pulls)),
    })
    const answer = async (id: string, answer: 'commit' | 'decline') => {
      const res = await harness.app.fetch(post(`/api/v1/attention/${id}/${answer}`, {}))
      expect(res.status).toBe(200)
    }
    await answer(declined.id, 'decline')
    await answer(committed.id, 'commit')

    const view = await list(harness)
    expect(
      view.requested.map((row) => [row.pullRequest.number, row.ask?.attentionId ?? null]),
    ).toStrictEqual([
      [2, askedOnly.id],
      [1, both.id],
    ])
    expect(view.requested[0]?.ask).toStrictEqual({
      attentionId: askedOnly.id,
      requestedByName: 'Igor',
      note: 'Touches billing',
    })
    expect(view.committed.map((row) => row.pullRequest.number)).toStrictEqual([4])

    await answer(askedOnly.id, 'commit')
    const after = await list(harness)
    expect(after.requested.map((row) => row.pullRequest.number)).toStrictEqual([1])
    expect(after.committed.map((row) => row.pullRequest.number).sort()).toStrictEqual([2, 4])
  })
})

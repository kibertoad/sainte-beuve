import type {
  AttentionRequest,
  DeclinedReviewRequest,
  MyReviews,
  OpenPullRequest,
  Project,
} from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  addReviewer,
  buildHarness,
  environmentVcs,
  get,
  openPullRequest,
  post,
  recordingChat,
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

/**
 * A host that is waiting on whoever its pull requests name, and stops when a
 * request is withdrawn, so a case can read the list again afterwards.
 */
function withdrawingVcs(username: string, pulls: OpenPullRequest[]) {
  const withdrawn: string[][] = []
  const vcs = viewerVcs(username, pulls)
  const find = (number: number) => pulls.find((open) => open.pullRequest.number === number)
  return {
    ...vcs,
    withdrawn,
    pendingReviewers: async (ref: { number: number }) => [
      ...(find(ref.number)?.requestedReviewerLogins ?? []),
    ],
    removeRequestedReviewers: async (ref: { number: number }, logins: string[]) => {
      withdrawn.push(logins)
      const open = find(ref.number)
      if (open !== undefined) {
        open.requestedReviewerLogins = open.requestedReviewerLogins.filter(
          (login) => !logins.includes(login),
        )
      }
    },
  }
}

async function decline(
  harness: TestHarness,
  open: OpenPullRequest,
  reason: string | null = null,
): Promise<DeclinedReviewRequest> {
  const res = await harness.app.fetch(
    post(`${MINE}/decline`, { pullRequest: open.pullRequest, title: open.title, reason }),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as DeclinedReviewRequest
}

describe('declining a review request', () => {
  it('withdraws the host request and comments to an author nobody can DM', async () => {
    const pulls = [pr(1, 'api', { requestedReviewerLogins: ['Ada'] })]
    const vcs = withdrawingVcs('ada', pulls)
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    await addProject(harness, 'api')

    const declined = await decline(harness, pulls[0]!, 'On leave')

    expect(declined).toStrictEqual({
      withdrawnOnHost: true,
      declinedAttentionIds: [],
      authorNotice: 'comment',
    })
    expect(vcs.withdrawn).toStrictEqual([['Ada']])
    expect(vcs.comments).toStrictEqual([
      { number: 1, body: '@bob: ada will not review this pull request.\n\n> On leave' },
    ])
    expect((await list(harness)).requested).toStrictEqual([])
  })

  it('DMs an author who has a Slack id instead of commenting', async () => {
    const pulls = [pr(1, 'api', { requestedReviewerLogins: ['ada'] })]
    const vcs = withdrawingVcs('ada', pulls)
    const chat = recordingChat()
    const harness = buildHarness({ vcs: environmentVcs(vcs), chat })
    await addProject(harness, 'api')
    await addReviewer(harness, {
      displayName: 'Bob',
      handles: { github: 'bob' },
      slackUserId: 'U-bob',
    })

    const declined = await decline(harness, pulls[0]!)

    expect(declined.authorNotice).toBe('chat')
    expect(chat.declinedNotices.map((entry) => entry.target)).toStrictEqual(['U-bob'])
    expect(chat.declinedNotices[0]?.notice.reason).toBeNull()
    expect(vcs.comments).toStrictEqual([])
  })

  it('declines a teammate ask on the same pull request, and only notifies the author for the host', async () => {
    const pulls = [pr(1, 'api'), pr(2, 'api', { requestedReviewerLogins: ['ada'] })]
    const asker = buildHarness({ vcs: environmentVcs(viewerVcs('kibertoad', pulls)) })
    await addProject(asker, 'api')
    await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    const ada = await addReviewer(asker, { displayName: 'Ada', handles: { github: 'ada' } })
    const res = await asker.app.fetch(
      post('/api/v1/attention', {
        pullRequest: pulls[0]!.pullRequest,
        title: pulls[0]!.title,
        recipientIds: [ada.id],
        neededCommitments: 1,
      }),
    )
    const ask = (await res.json()) as AttentionRequest
    const vcs = withdrawingVcs('ada', pulls)
    const harness = buildHarness({ ...asker.container, vcs: environmentVcs(vcs) })

    const declined = await decline(harness, pulls[0]!, 'Not my area')

    expect(declined).toStrictEqual({
      withdrawnOnHost: false,
      declinedAttentionIds: [ask.id],
      authorNotice: 'none',
    })
    const stored = await harness.container.repositories.attention.getById(ask.id)
    expect(stored?.declines.map((entry) => entry.reason)).toStrictEqual(['Not my area'])
    expect(vcs.comments).toStrictEqual([])
    expect((await list(harness)).requested.map((row) => row.pullRequest.number)).toStrictEqual([2])
  })

  it('answers with nothing done when nobody is waiting on the viewer any more', async () => {
    const pulls = [pr(1, 'api')]
    const vcs = withdrawingVcs('ada', pulls)
    const harness = buildHarness({ vcs: environmentVcs(vcs) })

    expect(await decline(harness, pulls[0]!)).toStrictEqual({
      withdrawnOnHost: false,
      declinedAttentionIds: [],
      authorNotice: 'none',
    })
    expect(vcs.withdrawn).toStrictEqual([])
  })

  it('fails without declining any ask when the host refuses the withdrawal', async () => {
    const pulls = [pr(1, 'api', { requestedReviewerLogins: ['ada'] })]
    const asker = buildHarness({ vcs: environmentVcs(viewerVcs('kibertoad', pulls)) })
    await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    const ada = await addReviewer(asker, { displayName: 'Ada', handles: { github: 'ada' } })
    await asker.app.fetch(
      post('/api/v1/attention', {
        pullRequest: pulls[0]!.pullRequest,
        title: pulls[0]!.title,
        recipientIds: [ada.id],
        neededCommitments: 1,
      }),
    )
    const refusing = {
      ...withdrawingVcs('ada', pulls),
      removeRequestedReviewers: () => Promise.reject(new Error('forbidden')),
    }
    const harness = buildHarness({ ...asker.container, vcs: environmentVcs(refusing) })

    const res = await harness.app.fetch(
      post(`${MINE}/decline`, { pullRequest: pulls[0]!.pullRequest, title: 'Title' }),
    )

    expect(res.status).toBeGreaterThanOrEqual(500)
    const [stored] = await harness.container.repositories.attention.list({ status: ['open'] })
    expect(stored?.declines).toStrictEqual([])
  })
})

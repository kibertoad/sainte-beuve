import type { MyPullRequests, OpenPullRequest, Project } from '@sainte-beuve/contracts'
import type { VcsIdentityGateway } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  buildHarness,
  cookieJar,
  environmentVcs,
  everyHost,
  get,
  openPullRequest,
  patch,
  post,
  stubGateways,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// My PRs through the app. Which pull request lands under which filter, and what
// a merge decision is, are tested purely in @sainte-beuve/reviewers; this suite
// covers the sweep, the status reads, and the refusals around a merge.

const MINE = '/api/v1/my-pull-requests'
const QUEUE = { label: 'Queue', body: '/merge' }

function pr(
  number: number,
  overrides: Partial<OpenPullRequest> = {},
  repo = 'api',
): OpenPullRequest {
  return openPullRequest({
    authorLogin: 'ada',
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

async function addProject(harness: TestHarness, body: object): Promise<Project> {
  const res = await harness.app.fetch(post('/api/v1/projects', { provider: 'github', ...body }))
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

async function list(harness: TestHarness, query = '', headers = {}): Promise<MyPullRequests> {
  const res = await harness.app.fetch(get(`${MINE}${query}`, headers))
  expect(res.status).toBe(200)
  return (await res.json()) as MyPullRequests
}

describe('listing', () => {
  it('lists the ten most recent of mine that still await approval', async () => {
    const pulls = [
      ...Array.from({ length: 12 }, (_, index) => pr(index + 1)),
      pr(20, { draft: true }),
      pr(21, { authorLogin: 'bob' }),
      pr(22),
    ]
    const vcs = viewerVcs('ada', pulls, { 22: { approval: 'approved' } })
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    await addProject(harness, { owner: 'acme', repo: 'api' })

    const view = await list(harness)
    expect(view.pullRequests.map((row) => row.pullRequest.number)).toStrictEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ])
    expect(view.complete).toBe(true)
    expect(view.pullRequests[0]?.merge.direct).toBe('allowed')
  })

  it('switches to approved or drafts on request', async () => {
    const pulls = [pr(1), pr(2, { draft: true }), pr(3)]
    const vcs = viewerVcs('ada', pulls, { 3: { approval: 'approved' } })
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    await addProject(harness, { owner: 'acme', repo: 'api' })

    const numbers = async (status: string) =>
      (await list(harness, `?status=${status}`)).pullRequests.map((row) => row.pullRequest.number)
    expect(await numbers('approved')).toStrictEqual([3])
    expect(await numbers('draft')).toStrictEqual([2])
    expect(await numbers('awaiting')).toStrictEqual([1])
  })

  it('sweeps only the projects the filter names', async () => {
    const vcs = viewerVcs('ada', [])
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    const api = await addProject(harness, { owner: 'acme', repo: 'api' })
    await addProject(harness, { owner: 'acme', repo: 'web' })
    await addProject(harness, { owner: 'other', repo: 'cli' })

    await list(harness, '?owner=ACME')
    expect(vcs.listed.map((project) => project.repo)).toStrictEqual(['api', 'web'])
    vcs.listed.length = 0
    await list(harness, `?projectId=${api.id}`)
    expect(vcs.listed.map((project) => project.repo)).toStrictEqual(['api'])
  })

  it('offers the most specific merge comments in force', async () => {
    const vcs = viewerVcs('ada', [pr(1), pr(2, {}, 'web')])
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    await harness.app.fetch(patch('/api/v1/settings/orgs/current', { mergeComments: [QUEUE] }))
    await addProject(harness, { owner: 'acme', repo: 'api' })
    const web = await addProject(harness, { owner: 'acme', repo: 'web' })
    const own = { label: 'Bors', body: 'bors r+' }
    await harness.app.fetch(patch(`/api/v1/projects/${web.id}`, { mergeComments: [own] }))

    const rows = (await list(harness)).pullRequests
    const byRepo = Object.fromEntries(rows.map((row) => [row.pullRequest.repo, row.merge]))
    expect(byRepo.api).toMatchObject({ comments: [QUEUE], commentsFrom: 'org' })
    expect(byRepo.web).toMatchObject({ comments: [own], commentsFrom: 'project' })
  })
})

describe('merging', () => {
  async function setUp(statuses = {}) {
    const vcs = viewerVcs('ada', [pr(1), pr(2, { authorLogin: 'bob' })], statuses)
    const harness = buildHarness({ vcs: environmentVcs(vcs) })
    const project = await addProject(harness, { owner: 'acme', repo: 'api' })
    const merge = (body: object) =>
      harness.app.fetch(post(`${MINE}/merge`, { projectId: project.id, ...body }))
    return { vcs, harness, project, merge }
  }

  it('merges my pull request at the head I saw', async () => {
    const { vcs, merge } = await setUp()
    const res = await merge({ number: 1, expectedHeadSha: 'sha-1' })
    expect(res.status).toBe(200)
    expect(vcs.merged).toStrictEqual([{ number: 1, sha: 'sha-1' }])
  })

  it('refuses a head that moved, a pull request that is not mine, and one the host blocks', async () => {
    const { vcs, merge } = await setUp({ 3: { authorLogin: 'ada', mergeability: 'blocked' } })
    expect((await merge({ number: 1, expectedHeadSha: 'stale' })).status).toBe(409)
    expect((await merge({ number: 2, expectedHeadSha: 'sha-2' })).status).toBe(403)
    expect((await merge({ number: 3, expectedHeadSha: 'sha-3' })).status).toBe(409)
    expect(vcs.merged).toStrictEqual([])
  })

  it('makes an admin confirm a merge the project restricts to its comments', async () => {
    const { vcs, harness, project, merge } = await setUp()
    await harness.app.fetch(
      patch(`/api/v1/projects/${project.id}`, {
        mergeComments: [QUEUE],
        restrictDirectMerge: true,
      }),
    )
    expect((await list(harness)).pullRequests[0]?.merge.direct).toBe('override')
    expect((await merge({ number: 1, expectedHeadSha: 'sha-1' })).status).toBe(409)
    const res = await merge({ number: 1, expectedHeadSha: 'sha-1', override: true })
    expect(res.status).toBe(200)
    expect(vcs.merged).toHaveLength(1)
  })

  it('posts a merge comment in force, and nothing else', async () => {
    const { vcs, harness, project } = await setUp()
    await harness.app.fetch(patch(`/api/v1/projects/${project.id}`, { mergeComments: [QUEUE] }))
    const comment = (body: object) =>
      harness.app.fetch(
        post(`${MINE}/merge-comment`, { projectId: project.id, number: 1, ...body }),
      )

    expect((await comment({ comment: { label: 'Queue', body: 'rm -rf' } })).status).toBe(400)
    expect((await comment({ comment: QUEUE })).status).toBe(200)
    expect(vcs.comments).toStrictEqual([{ number: 1, body: '/merge' }])
  })
})

describe('a member on a restricted project', () => {
  const KEY = btoa('0123456789abcdef0123456789abcdef')
  const BOOTSTRAP = 'the-operators-key'

  function harnessFor(username: string, subject: string, base?: TestHarness): TestHarness {
    const signIn: VcsIdentityGateway = {
      authorizeUrl: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
      exchangeCode: async () => ({
        token: 'gho_token',
        account: { subject, username, displayName: username, avatarUrl: null },
      }),
    }
    return buildHarness(
      {
        vcs: environmentVcs(viewerVcs('bob', [pr(1, { authorLogin: 'bob' })])),
        ...base?.container,
        gateways: stubGateways({ signIn: everyHost(signIn) }),
        auth: {
          mode: 'required',
          environmentApiKey: BOOTSTRAP,
          sessionLifetimeMs: 60_000_000,
          devMode: false,
        },
      },
      { encryptionKey: KEY },
    )
  }

  async function signIn(harness: TestHarness): Promise<string> {
    const jar = cookieJar()
    const start = await harness.app.fetch(get('/api/v1/auth/sign-in/github'))
    jar.keep(start)
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
    const callback = await harness.app.fetch(
      get(
        `/connect/github/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
        jar.headers(),
      ),
    )
    jar.keep(callback)
    return jar.headers().cookie ?? ''
  }

  it('is refused the direct merge and offered the comments', async () => {
    const harness = harnessFor('ada', '1')
    const admin = { cookie: await signIn(harness) }
    const bootstrap = { authorization: `Bearer ${BOOTSTRAP}` }
    await harness.app.fetch(
      post('/api/v1/reviewers', { displayName: 'bob', handles: { github: 'bob' } }, bootstrap),
    )
    const bob = { cookie: await signIn(harnessFor('bob', '2', harness)) }
    const project = (await (
      await harness.app.fetch(
        post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'api' }, admin),
      )
    ).json()) as Project
    await harness.app.fetch(
      patch(
        `/api/v1/projects/${project.id}`,
        { mergeComments: [QUEUE], restrictDirectMerge: true },
        admin,
      ),
    )

    expect((await list(harness, '', bob)).pullRequests[0]?.merge.direct).toBe('restricted')
    const res = await harness.app.fetch(
      post(
        `${MINE}/merge`,
        { projectId: project.id, number: 1, expectedHeadSha: 'sha-1', override: true },
        bob,
      ),
    )
    expect(res.status).toBe(403)
  })
})

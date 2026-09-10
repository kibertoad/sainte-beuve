import type { Project, Viewer, Workspace } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addReviewer,
  appVcs,
  buildHarness,
  del,
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

// The main working space, through the app: who the viewer is, which projects
// are swept, and how the three lists are cut. What each list MEANS is tested
// purely in @sainte-beuve/reviewers; this suite covers the half that resolves a
// credential, talks to a host and answers HTTP.

const PROJECTS = '/api/v1/projects'

function harnessFor(username: string, pullRequests = [] as ReturnType<typeof openPullRequest>[]) {
  return buildHarness({ vcs: environmentVcs(viewerVcs(username, pullRequests)) })
}

async function addProject(harness: TestHarness, body: Record<string, unknown>): Promise<Project> {
  const res = await harness.app.fetch(post(PROJECTS, body))
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

async function workspace(harness: TestHarness): Promise<Workspace> {
  const res = await harness.app.fetch(get('/api/v1/workspace'))
  expect(res.status).toBe(200)
  return (await res.json()) as Workspace
}

describe('the viewer', () => {
  it('refuses to guess when no credential names a person', async () => {
    const res = await buildHarness().app.fetch(get('/api/v1/me'))
    // 503 with the fix in it, not an empty workspace: a screen that showed
    // nothing would look like a team with no open pull requests.
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('Configuration screen') },
    })
  })

  it('creates a person on first sight and keys them on the stable subject', async () => {
    const harness = harnessFor('kibertoad')
    const viewer = (await (await harness.app.fetch(get('/api/v1/me'))).json()) as Viewer

    expect(viewer.reviewer.handles.github).toBe('kibertoad')
    expect(viewer.identities).toStrictEqual([
      {
        provider: 'github',
        subject: 'subject-kibertoad',
        username: 'kibertoad',
        linkedAt: harness.clock.now(),
      },
    ])
  })

  it('adopts the directory row somebody was already registered as', async () => {
    const harness = harnessFor('kibertoad')
    const created = await harness.app.fetch(
      post('/api/v1/reviewers', {
        displayName: 'Igor',
        handles: { github: 'Kibertoad' },
        skills: ['Backend'],
      }),
    )
    const registered = (await created.json()) as { id: string }

    const viewer = (await (await harness.app.fetch(get('/api/v1/me'))).json()) as Viewer

    // Forking the directory here would hand the person an empty skill list and
    // leave the router drawing the other row for ever.
    expect(viewer.reviewer.id).toBe(registered.id)
    expect(viewer.reviewer.skills).toStrictEqual(['Backend'])
  })

  it('is the person behind the credential on a deployment that also holds an App', async () => {
    // An App installation identifies nobody, so resolving the viewer through the
    // acting credential would answer 503 and tell the operator to sign in, which
    // is the thing they already did.
    const harness = buildHarness({
      vcs: environmentVcs(viewerVcs('kibertoad')),
      gateways: stubGateways({ vcsAsApp: (provider) => (provider === 'github' ? appVcs() : null) }),
    })

    const res = await harness.app.fetch(get('/api/v1/me'))

    expect(res.status).toBe(200)
    expect(((await res.json()) as Viewer).reviewer.handles.github).toBe('kibertoad')
  })

  it('answers the same person twice rather than creating a second row', async () => {
    const harness = harnessFor('kibertoad')
    const first = (await (await harness.app.fetch(get('/api/v1/me'))).json()) as Viewer
    const second = (await (await harness.app.fetch(get('/api/v1/me'))).json()) as Viewer

    expect(second.reviewer.id).toBe(first.reviewer.id)
    const listed = await harness.app.fetch(get('/api/v1/reviewers'))
    expect(((await listed.json()) as { reviewers: unknown[] }).reviewers).toHaveLength(1)
  })

  it('creates one person when a page load asks three times at once', async () => {
    const harness = harnessFor('kibertoad')

    // What the first page load actually does: the workspace, the inbox and the
    // stream each resolve the viewer, and none of them has a row to find yet.
    // Three rows for one human leaves two orphans that the reviewer screen
    // draws and the router can pick.
    await Promise.all([
      harness.app.fetch(get('/api/v1/me')),
      harness.app.fetch(get('/api/v1/workspace')),
      harness.app.fetch(get('/api/v1/attention')),
    ])

    expect(await harness.container.repositories.reviewers.list()).toHaveLength(1)
  })
})

describe('the project registry', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = harnessFor('kibertoad')
  })

  it('registers a project with the default skill vocabulary', async () => {
    const project = await addProject(harness, {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
    })
    expect(project.skills).toStrictEqual(['Backend', 'Frontend'])
  })

  it('keeps an explicit empty skill list rather than filling in the defaults', async () => {
    const project = await addProject(harness, {
      provider: 'gitlab',
      owner: 'platform',
      repo: 'api',
      skills: [],
    })
    expect(project.skills).toStrictEqual([])
  })

  it('refuses the same repository twice', async () => {
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })
    const again = await harness.app.fetch(
      post(PROJECTS, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' }),
    )
    expect(again.status).toBe(409)
  })

  it('lets a team put its own vocabulary on a project', async () => {
    const project = await addProject(harness, {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
    })
    const res = await harness.app.fetch(
      patch(`${PROJECTS}/${project.id}`, { skills: ['Go', 'Terraform'] }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as Project).skills).toStrictEqual(['Go', 'Terraform'])
  })

  it('un-registers a project and answers with what is left', async () => {
    const project = await addProject(harness, {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
    })
    const res = await harness.app.fetch(del(`${PROJECTS}/${project.id}`))
    expect(res.status).toBe(200)
    expect((await res.json()) as { projects: Project[] }).toStrictEqual({ projects: [] })
  })
})

describe('the workspace', () => {
  it('splits the open pull requests into the lists the viewer has to act on', async () => {
    const mine = openPullRequest({ authorLogin: 'kibertoad', title: 'Mine', updatedAt: 2 })
    const forMe = openPullRequest({
      authorLogin: 'peer',
      requestedReviewerLogins: ['kibertoad'],
      title: 'Waiting on me',
    })
    const other = openPullRequest({ authorLogin: 'peer', title: 'Somebody else' })
    const harness = harnessFor('kibertoad', [mine, forMe, other])
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })

    const board = await workspace(harness)

    expect(board.authored.map((pr) => pr.title)).toStrictEqual(['Mine'])
    expect(board.reviewRequested.map((pr) => pr.title)).toStrictEqual(['Waiting on me'])
    expect(board.sources).toStrictEqual([
      {
        projectId: expect.any(String),
        provider: 'github',
        owner: 'kibertoad',
        repo: 'sainte-beuve',
        ok: true,
        reason: null,
      },
    ])
  })

  it('reports a host it has no credential for instead of failing the whole read', async () => {
    const mine = openPullRequest({ authorLogin: 'kibertoad' })
    const harness = harnessFor('kibertoad', [mine])
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })
    await addProject(harness, { provider: 'gitlab', owner: 'platform', repo: 'api' })

    const board = await workspace(harness)

    // The GitHub half still works. A deployment connected to one host and not
    // the other is the normal state, not an outage.
    expect(board.authored).toHaveLength(1)
    const gitlab = board.sources.find((source) => source.provider === 'gitlab')
    expect(gitlab).toMatchObject({ ok: false, reason: expect.stringContaining('no credential') })
  })

  it('reads each project once, whichever list its pull requests land in', async () => {
    const gateway = viewerVcs('kibertoad', [
      openPullRequest({ authorLogin: 'kibertoad' }),
      openPullRequest({ authorLogin: 'peer', requestedReviewerLogins: ['kibertoad'] }),
    ])
    const harness = buildHarness({ vcs: environmentVcs(gateway) })
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })

    await workspace(harness)

    // Both hosts return the author and the reviewers on the same page, so a
    // second call per role would double the rate-limit cost of this screen.
    expect(gateway.listed).toHaveLength(1)
  })

  it('does not hand the viewer a stranger who holds their other host name', async () => {
    const stranger = openPullRequest({ authorLogin: 'igor.savin', title: 'Somebody else' })
    const mine = openPullRequest({ authorLogin: 'kibertoad', title: 'Mine' })
    const harness = harnessFor('kibertoad', [stranger, mine])
    // The viewer adopts this row, so they hold a handle on each host.
    await addReviewer(harness, {
      displayName: 'Igor',
      handles: { github: 'kibertoad', gitlab: 'igor.savin' },
    })
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })

    const board = await workspace(harness)

    // `igor.savin` is who the viewer is on GitLab. The GitHub account of that
    // name is a different human, and the ask buttons act on what is listed here.
    expect(board.authored.map((pr) => pr.title)).toStrictEqual(['Mine'])
    expect(board.reviewRequested).toStrictEqual([])
  })

  it('reaches repositories as the App while the viewer stays the person', async () => {
    const seen = openPullRequest({ authorLogin: 'kibertoad', title: 'Seen by the App' })
    const harness = buildHarness({
      // The environment's own credential names the viewer and lists nothing; the
      // App lists the work. Both halves of the precedence at once.
      vcs: environmentVcs(viewerVcs('kibertoad')),
      gateways: stubGateways({ vcsAsApp: everyHost(appVcs([seen])) }),
    })
    await addProject(harness, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve' })

    const board = await workspace(harness)

    expect(board.viewer.reviewer.handles.github).toBe('kibertoad')
    expect(board.authored.map((pr) => pr.title)).toStrictEqual(['Seen by the App'])
  })

  it('starts empty for a viewer with no projects registered', async () => {
    const board = await workspace(harnessFor('kibertoad'))
    expect(board).toMatchObject({ authored: [], reviewRequested: [], committed: [], sources: [] })
  })
})

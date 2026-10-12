import type { ReviewRequest } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { withOrg } from '../src/container.js'
import {
  addReviewer,
  buildHarness,
  post,
  recordingVcs,
  stubGateways,
  type TestHarness,
} from './helpers.js'

// GitLab deliveries through the app: the token gate, the org the URL names, the
// project registry, and the writes, together. What each payload MEANS is tested
// against fixtures in @sainte-beuve/integrations.

const KEY = btoa('0123456789abcdef0123456789abcdef')
const SECRET = 'the-gitlab-webhook-token'
const MR_URL = 'https://gitlab.com/acme/platform/api/-/merge_requests/7'
const PROJECT = { path_with_namespace: 'acme/platform/api' }

function mergeRequest(action: string, extra: Record<string, unknown> = {}): unknown {
  return {
    object_kind: 'merge_request',
    user: { username: 'ada' },
    project: PROJECT,
    object_attributes: { iid: 7, title: 'Add a health check', url: MR_URL, action, draft: false },
    labels: [],
    ...extra,
  }
}

function labelled(...added: string[]): unknown {
  const current = added.map((title) => ({ title }))
  return mergeRequest('update', { labels: current, changes: { labels: { previous: [], current } } })
}

function note(body: string, username = 'grace'): unknown {
  return {
    object_kind: 'note',
    user: { username },
    project: PROJECT,
    object_attributes: { note: body, noteable_type: 'MergeRequest' },
    merge_request: { iid: 7, title: 'Add a health check', url: MR_URL },
  }
}

async function deliver(
  harness: TestHarness,
  payload: unknown,
  options: { token?: string | null; path?: string } = {},
): Promise<Response> {
  const token = options.token === undefined ? SECRET : options.token
  return harness.app.fetch(
    new Request(`http://localhost${options.path ?? '/webhooks/gitlab'}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Gitlab-Event': 'Merge Request Hook',
        ...(token === null ? {} : { 'X-Gitlab-Token': token }),
      },
      body: JSON.stringify(payload),
    }),
  )
}

/** One sealed credential, in the org the store is bound to. */
async function store(
  harness: TestHarness,
  orgId: string,
  credential: {
    integrationId: 'gitlab-webhook-secret' | 'gitlab-pat'
    value: string
    subject?: string
  },
): Promise<void> {
  const { integrationId, value, subject = null } = credential
  const cipher = harness.container.secrets
  if (cipher === null) throw new Error('this case needs the harness cipher')
  await harness.container.stores.forOrg(orgId).integrationTokens.put({
    integrationId,
    sealed: await cipher.encrypt(value, integrationId),
    hint: value.slice(-4),
    subject,
    updatedAt: harness.clock.now(),
  })
}

async function tracked(harness: TestHarness): Promise<ReviewRequest[]> {
  return harness.container.repositories.reviews.list()
}

describe('GitLab webhook intake', () => {
  let harness: TestHarness
  let vcs: ReturnType<typeof recordingVcs>

  beforeEach(async () => {
    vcs = recordingVcs()
    harness = buildHarness(
      { gateways: stubGateways({ vcsFromToken: () => vcs }) },
      { encryptionKey: KEY },
    )
    await store(harness, harness.container.orgId, {
      integrationId: 'gitlab-webhook-secret',
      value: SECRET,
    })
    // The bot is the account of the stored GitLab credential: replies are
    // posted as it, so it is the name people mention.
    await store(harness, harness.container.orgId, {
      integrationId: 'gitlab-pat',
      value: 'glpat-0123456789',
      subject: 'review-bot',
    })
    const res = await harness.app.fetch(
      post('/api/v1/projects', { provider: 'gitlab', owner: 'acme/platform', repo: 'api' }),
    )
    expect(res.status).toBe(201)
  })

  it('refuses a delivery on the default path when no secret is stored, naming the fix', async () => {
    const unconfigured = buildHarness({}, { encryptionKey: KEY })
    const res = await deliver(unconfigured, mergeRequest('open'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('GitLab webhook secret') },
    })
  })

  it('refuses a delivery carrying the wrong token, or none', async () => {
    expect((await deliver(harness, mergeRequest('open'), { token: 'guess' })).status).toBe(403)
    expect((await deliver(harness, mergeRequest('open'), { token: null })).status).toBe(403)
    expect(await tracked(harness)).toStrictEqual([])
  })

  it('tracks an opened merge request and leaves it unassigned', async () => {
    const res = await deliver(harness, mergeRequest('open'))
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ action: 'tracked' })
    const [review] = await tracked(harness)
    expect(review).toMatchObject({
      status: 'open',
      authorLogin: 'ada',
      pullRequest: { provider: 'gitlab', owner: 'acme/platform', repo: 'api', number: 7 },
    })
  })

  it('routes on the review label and requests the reviewer on GitLab', async () => {
    await addReviewer(harness, { displayName: 'Peer', handles: { gitlab: 'peer' } })
    const res = await deliver(harness, labelled('needs-review'))
    expect(await res.json()).toMatchObject({ action: 'assigned' })
    expect(vcs.requested).toStrictEqual([['peer']])
  })

  it('closes the review when the merge request is merged', async () => {
    await deliver(harness, mergeRequest('open'))
    const res = await deliver(harness, mergeRequest('merge'))
    expect(await res.json()).toMatchObject({ action: 'closed' })
    expect((await tracked(harness))[0]?.status).toBe('closed')
  })

  it('settles on approval and puts the review back when the approval is taken back', async () => {
    await addReviewer(harness, { displayName: 'Peer', handles: { gitlab: 'peer' } })
    await deliver(harness, labelled('needs-review'))
    await deliver(harness, mergeRequest('approved'))
    expect((await tracked(harness))[0]?.status).toBe('approved')

    const res = await deliver(harness, mergeRequest('unapproved'))
    expect(await res.json()).toMatchObject({ action: 'assigned' })
    expect((await tracked(harness))[0]?.status).toBe('assigned')
  })

  it('ignores a verified delivery about a project this org never registered', async () => {
    const elsewhere = {
      ...(mergeRequest('open') as object),
      project: { path_with_namespace: 'x/y' },
    }
    const res = await deliver(harness, elsewhere)
    expect(await res.json()).toMatchObject({ action: 'ignored:unregistered' })
    expect(await tracked(harness)).toStrictEqual([])
  })

  it('answers a mention from somebody the directory knows, on the merge request', async () => {
    await addReviewer(harness, { displayName: 'Grace', handles: { gitlab: 'grace' } })
    await addReviewer(harness, { displayName: 'Peer', handles: { gitlab: 'peer' } })
    const res = await deliver(harness, note('@review-bot review'))
    expect(await res.json()).toMatchObject({ action: 'command:review' })
    expect(vcs.comments).toHaveLength(1)
    expect(vcs.comments[0]?.body).toContain('Review requested from')
  })

  it('stays silent for a commenter the directory does not know', async () => {
    const res = await deliver(harness, note('@review-bot ai', 'stranger'))
    expect(await res.json()).toMatchObject({ action: 'ignored' })
    expect(vcs.comments).toStrictEqual([])
    expect(await tracked(harness)).toStrictEqual([])
  })
})

describe('GitLab intake, per org', () => {
  let harness: TestHarness

  async function makeOrg(slug: string): Promise<string> {
    const org = await harness.container.stores.orgs.create({
      id: `org-${slug}`,
      slug,
      name: slug,
      enrolment: 'invite',
      defaultRepositoryOwner: null,
      mergeComments: [],
      domains: [],
      createdAt: harness.clock.now(),
    })
    return org.id
  }

  beforeEach(async () => {
    harness = buildHarness({}, { encryptionKey: KEY })
    const res = await harness.app.fetch(
      post('/api/v1/projects', { provider: 'gitlab', owner: 'acme/platform', repo: 'api' }),
    )
    expect(res.status).toBe(201)
  })

  it('answers an unknown slug and an org with no secret with the same refusal', async () => {
    await makeOrg('bare')
    const unknown = await deliver(harness, mergeRequest('open'), { path: '/webhooks/gitlab/nope' })
    const secretless = await deliver(harness, mergeRequest('open'), {
      path: '/webhooks/gitlab/bare',
    })
    expect(unknown.status).toBe(403)
    expect(secretless.status).toBe(403)
    expect(await secretless.json()).toStrictEqual(await unknown.json())
  })

  it("acts only on the named org's own projects, not on the default org's", async () => {
    const orgId = await makeOrg('acme')
    await store(harness, orgId, { integrationId: 'gitlab-webhook-secret', value: SECRET })
    // Verified for `acme`, about a project only the default org registered.
    const res = await deliver(harness, mergeRequest('open'), { path: '/webhooks/gitlab/acme' })
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ action: 'ignored:unregistered' })
    expect(await tracked(harness)).toStrictEqual([])
  })

  it('acts for an org that registered a project an older org also holds', async () => {
    const orgId = await makeOrg('acme')
    await store(harness, orgId, { integrationId: 'gitlab-webhook-secret', value: SECRET })
    const acme = withOrg(harness.container, orgId)
    await acme.repositories.projects.create({
      id: 'project-acme',
      provider: 'gitlab',
      owner: 'acme/platform',
      repo: 'api',
      webUrl: null,
      skills: [],
      domains: [],
      mergeComments: null,
      restrictDirectMerge: false,
      createdAt: harness.clock.now() + 1,
    })

    const res = await deliver(harness, mergeRequest('open'), { path: '/webhooks/gitlab/acme' })
    expect(await res.json()).toMatchObject({ action: 'tracked' })
    expect(await acme.repositories.reviews.list()).toHaveLength(1)
    expect(await tracked(harness)).toStrictEqual([])
  })
})

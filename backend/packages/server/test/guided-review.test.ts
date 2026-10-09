import type {
  GuidedReviewSessionView,
  GuidedReviewTarget,
  GuidedReviewThreadView,
} from '@sainte-beuve/contracts'
import type { GuidedReviewGateway, GuidedReviewWatchEvent } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { withOrg } from '../src/container.js'
import { buildHarness, get, patch, post, type TestHarness } from './helpers.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'

/**
 * The guided-review relay over `app.fetch`. What this deployment adds to
 * cat-factory's surface is the tenancy check, so that is what most cases pin:
 * a session outside this org's registered projects is not found, and nothing
 * is asked of cat-factory on its behalf.
 */
const BASE = '/api/v1/guided-reviews'

function sessionView(sessionId: string, repo: string): GuidedReviewSessionView {
  return {
    session: {
      id: sessionId,
      provider: 'github',
      repoId: 'repo-1',
      owner: 'kibertoad',
      repo,
      prNumber: 7,
      prTitle: 'Add a widget',
      reviewedHeadSha: 'abc123',
      baseRef: 'main',
      createdBy: 'key-1',
      createdByKind: 'api-key',
      overview: { status: 'pending', generation: 1, content: null, failure: null, model: null },
      createdAt: 1,
      updatedAt: 1,
    },
    threads: [],
    drafts: [],
  }
}

function threadView(sessionId: string): GuidedReviewThreadView {
  return {
    thread: {
      id: 'thr-1',
      sessionId,
      title: 'Why',
      createdBy: 'key-1',
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [],
  }
}

interface StubGuidedReview extends GuidedReviewGateway {
  calls: string[]
  /** What the next `watch` yields, in order. */
  frames: GuidedReviewWatchEvent[]
}

/** cat-factory holding `grs-ours` on a registered repository and `grs-theirs` on another. */
function stubGuidedReview(): StubGuidedReview {
  const sessions: Record<string, GuidedReviewSessionView> = {
    'grs-ours': sessionView('grs-ours', 'sainte-beuve'),
    'grs-theirs': sessionView('grs-theirs', 'elsewhere'),
  }
  const read = (sessionId: string) => {
    const view = sessions[sessionId]
    if (view === undefined) throw new Error(`no session ${sessionId}`)
    return view
  }
  const calls: string[] = []
  const record = <T>(call: string, answer: T): Promise<T> => {
    calls.push(call)
    return Promise.resolve(answer)
  }
  const stub: StubGuidedReview = {
    calls,
    frames: [],
    async *watch(sessionId) {
      calls.push(`watch ${sessionId}`)
      yield* stub.frames
    },
    find: (target: GuidedReviewTarget) => record(`find ${target.repo}`, null),
    open: (target) => record(`open ${target.repo}#${target.number}`, read('grs-ours')),
    get: (sessionId) => record(`get ${sessionId}`, read(sessionId)),
    refresh: (sessionId) => record(`refresh ${sessionId}`, read(sessionId)),
    openThread: (sessionId) => record(`openThread ${sessionId}`, threadView(sessionId)),
    getThread: (sessionId) => record(`getThread ${sessionId}`, threadView(sessionId)),
    ask: (sessionId) => {
      calls.push(`ask ${sessionId}`)
      return Promise.reject(
        new ConflictError('cat-factory would not ask', {
          upstream: 'cat-factory',
          reason: 'thread_busy',
        }),
      )
    },
    requestDrafts: (sessionId) => {
      calls.push(`requestDrafts ${sessionId}`)
      return Promise.reject(new Error('not exercised'))
    },
    editDraft: (sessionId, draftId) => {
      calls.push(`editDraft ${sessionId} ${draftId}`)
      return Promise.reject(
        new ConflictError('cat-factory would not edit', {
          upstream: 'cat-factory',
          reason: 'draft_conflict',
        }),
      )
    },
    postDrafts: (sessionId, input) =>
      record(`postDrafts ${sessionId} ${input.draftIds.join(',')}`, {
        drafts: [],
        posted: input.draftIds.length,
        failed: 0,
        skipped: [],
        summary: { posted: null, error: null },
      }),
  }
  return stub
}

async function registerProject(harness: TestHarness): Promise<void> {
  await harness.container.repositories.projects.create({
    id: 'project-1',
    provider: 'github',
    owner: 'Kibertoad',
    repo: 'Sainte-Beuve',
    webUrl: null,
    skills: [],
    domains: [],
    mergeComments: null,
    restrictDirectMerge: false,
    createdAt: 0,
  })
}

describe('guided review', () => {
  let harness: TestHarness
  let catFactory: StubGuidedReview

  beforeEach(async () => {
    catFactory = stubGuidedReview()
    harness = await connectCatFactory(buildHarness(catFactoryWired({ guidedReview: catFactory })))
    await registerProject(harness)
  })

  it('opens a review of a pull request in a registered project', async () => {
    const res = await harness.app.fetch(
      post(BASE, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve', number: 7 }),
    )

    expect(res.status).toBe(200)
    expect(((await res.json()) as GuidedReviewSessionView).session.id).toBe('grs-ours')
    expect(catFactory.calls).toStrictEqual(['open sainte-beuve#7'])
  })

  it('refuses a pull request in a repository this org has not registered, before asking', async () => {
    const res = await harness.app.fetch(
      get(`${BASE}?provider=github&owner=kibertoad&repo=elsewhere&number=7`),
    )

    expect(res.status).toBe(404)
    expect(catFactory.calls).toStrictEqual([])
  })

  it('answers a lookup that finds nothing with a null session', async () => {
    const res = await harness.app.fetch(
      get(`${BASE}?provider=github&owner=kibertoad&repo=sainte-beuve&number=7`),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ session: null })
  })

  it("reads another org's session as not found, and acts on nothing in it", async () => {
    const read = await harness.app.fetch(get(`${BASE}/grs-theirs`))
    const asked = await harness.app.fetch(
      post(`${BASE}/grs-theirs/threads`, { question: { content: 'What does it do?' } }),
    )

    expect(read.status).toBe(404)
    expect(asked.status).toBe(404)
    expect(catFactory.calls).toStrictEqual(['get grs-theirs', 'get grs-theirs'])
  })

  it('leaves the sessions of a repository two orgs hold to the older claim', async () => {
    await withOrg(harness.container, 'org-earlier').repositories.projects.create({
      id: 'project-earlier',
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      webUrl: null,
      skills: [],
      domains: [],
      mergeComments: null,
      restrictDirectMerge: false,
      createdAt: -1,
    })

    const read = await harness.app.fetch(get(`${BASE}/grs-ours`))
    const opened = await harness.app.fetch(
      post(BASE, { provider: 'github', owner: 'kibertoad', repo: 'sainte-beuve', number: 7 }),
    )

    expect(read.status).toBe(404)
    expect(opened.status).toBe(404)
    expect(catFactory.calls).toStrictEqual(['get grs-ours'])
  })

  it('opens a thread on a session of its own', async () => {
    const res = await harness.app.fetch(
      post(`${BASE}/grs-ours/threads`, { question: { content: 'What does it do?' } }),
    )

    expect(res.status).toBe(200)
    expect(catFactory.calls).toStrictEqual(['get grs-ours', 'openThread grs-ours'])
  })

  it("passes cat-factory's reason for a refusal through to the screen", async () => {
    const res = await harness.app.fetch(
      post(`${BASE}/grs-ours/threads/thr-1/messages`, { content: 'And then?' }),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { details: { reason: 'thread_busy' } } })
  })

  it('posts the named drafts of a session of its own', async () => {
    const res = await harness.app.fetch(
      post(`${BASE}/grs-ours/comment-drafts/post`, { draftIds: ['drf-1', 'drf-2'] }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ posted: 2, failed: 0 })
    expect(catFactory.calls).toStrictEqual(['get grs-ours', 'postDrafts grs-ours drf-1,drf-2'])
  })

  it("posts nothing on another org's pull request", async () => {
    const res = await harness.app.fetch(
      post(`${BASE}/grs-theirs/comment-drafts/post`, { draftIds: ['drf-1'] }),
    )

    expect(res.status).toBe(404)
    expect(catFactory.calls).toStrictEqual(['get grs-theirs'])
  })

  it('reports a stale edit as a conflict a screen can name', async () => {
    const res = await harness.app.fetch(
      patch(`${BASE}/grs-ours/comment-drafts/drf-1`, { rev: 1, body: 'Tighter wording' }),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { details: { reason: 'draft_conflict' } } })
  })

  it('streams the session it opened on, then what cat-factory pushes, and reconnects at once on its cap', async () => {
    catFactory.frames = [
      { kind: 'state', view: { ...sessionView('grs-ours', 'sainte-beuve'), drafts: [] } },
      { kind: 'timeout' },
    ]

    const res = await harness.app.fetch(get(`${BASE}/grs-ours/stream`))
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(body.match(/event: guidedReview/g)).toHaveLength(2)
    expect(body).toContain('"kind":"state"')
    expect(body.trimEnd().endsWith('retry: 3000')).toBe(true)
    expect(catFactory.calls).toStrictEqual(['get grs-ours', 'watch grs-ours'])
  })

  it('relays a deleted session and tells the browser to back off', async () => {
    catFactory.frames = [{ kind: 'deleted' }]

    const body = await (await harness.app.fetch(get(`${BASE}/grs-ours/stream`))).text()

    expect(body).toContain('"kind":"deleted"')
    expect(body.trimEnd().endsWith('retry: 30000')).toBe(true)
  })

  it("streams nothing of another org's session", async () => {
    const res = await harness.app.fetch(get(`${BASE}/grs-theirs/stream`))

    expect(res.status).toBe(404)
    expect(catFactory.calls).toStrictEqual(['get grs-theirs'])
  })

  it('names the missing configuration when no cat-factory is wired', async () => {
    const bare = buildHarness()
    await registerProject(bare)

    const res = await bare.app.fetch(get(`${BASE}/grs-ours`))

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { message: /`write` scope/ } })
  })
})

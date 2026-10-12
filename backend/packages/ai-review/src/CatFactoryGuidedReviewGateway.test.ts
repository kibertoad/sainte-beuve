import { entityKey } from '@cat-factory/directory-sync'
import { describe, expect, it } from 'vitest'
import { CatFactoryGuidedReviewGateway } from './CatFactoryGuidedReviewGateway.js'

interface Call {
  method: string
  path: string
  query: string
  body: unknown
  workspace: string | null
}

type Answer = { status?: number; body: unknown }

/**
 * A gateway over canned answers, recording every call it makes. A route is
 * keyed by `METHOD path`, or by `workspace METHOD path` for an answer that only
 * one workspace gives; every other workspace then gets the 404 cat-factory
 * answers for a session it does not hold.
 */
function gatewayOver(routes: Record<string, Answer>): {
  gateway: CatFactoryGuidedReviewGateway
  calls: Call[]
} {
  const calls: Call[] = []
  const gateway = new CatFactoryGuidedReviewGateway({
    baseUrl: 'https://cat-factory.example.com',
    apiKey: 'cf_live_key.secret',
    fetch: async (input, init) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const raw = init?.body
      const workspace = new Headers(init?.headers).get('x-cat-factory-workspace')
      calls.push({
        method,
        path: url.pathname,
        query: url.search,
        body: typeof raw === 'string' ? JSON.parse(raw) : null,
        workspace,
      })
      const route = `${method} ${url.pathname}`
      const answer = (workspace === null ? undefined : routes[`${workspace} ${route}`]) ??
        routes[route] ?? {
          status: 404,
          body: { error: { code: 'not_found', message: url.pathname } },
        }
      return new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { gateway, calls }
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grs-1',
    provider: 'github',
    repoId: 'repo-1',
    owner: 'Acme',
    repo: 'Widgets',
    prNumber: 7,
    prTitle: 'Add a widget',
    reviewedHeadSha: 'abc123',
    baseRef: 'main',
    createdBy: 'key-1',
    createdByKind: 'api-key',
    overview: { status: 'pending', generation: 1, content: null, failure: null, model: null },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function view(overrides: Record<string, unknown> = {}) {
  return { session: session(overrides), threads: [], drafts: [] }
}

const target = { provider: 'github', owner: 'acme', repo: 'widgets', number: 7 } as const

/** Session `grs-1`, in whichever workspaces `directoryKeys` name: none names the key's only one. */
function grs1(directoryKeys: readonly string[] = []) {
  return { sessionId: 'grs-1', directoryKeys }
}

describe('CatFactoryGuidedReviewGateway', () => {
  it('finds the session for a pull request among same-numbered ones in other repositories', async () => {
    const { gateway, calls } = gatewayOver({
      'GET /api/v1/guided-reviews': {
        body: {
          sessions: [session({ id: 'grs-other', repo: 'gadgets' }), session()],
          nextCursor: null,
        },
      },
      'GET /api/v1/guided-reviews/grs-1': { body: view() },
    })

    await expect(gateway.find(target, [])).resolves.toMatchObject({ session: { id: 'grs-1' } })
    expect(calls[0]?.query).toContain('prNumber=7')
    expect(calls[0]?.query).toContain('mine=true')
  })

  it('finds nothing, and opens nothing, for a pull request without a session', async () => {
    const { gateway, calls } = gatewayOver({
      'GET /api/v1/guided-reviews': { body: { sessions: [], nextCursor: null } },
    })

    await expect(gateway.find(target, [])).resolves.toBeNull()
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })

  it('opens a session by the coordinates cat-factory addresses a pull request with', async () => {
    const { gateway, calls } = gatewayOver({ 'POST /api/v1/guided-reviews': { body: view() } })

    await gateway.open(target, [])

    expect(calls[0]?.body).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
    })
  })

  it("carries cat-factory's reason for a refusal, so a screen can say what to do", async () => {
    const { gateway } = gatewayOver({
      'POST /api/v1/guided-reviews': {
        status: 404,
        body: {
          error: {
            code: 'not_found',
            message: 'Repository acme/widgets not found',
            details: { reason: 'repo_not_linked' },
          },
        },
      },
    })

    await expect(gateway.open(target, [])).rejects.toMatchObject({
      code: 'not_found',
      details: { upstream: 'cat-factory', reason: 'repo_not_linked' },
    })
  })

  it('falls back to the error code when cat-factory names no reason', async () => {
    const { gateway } = gatewayOver({
      'POST /api/v1/guided-reviews/grs-1/threads/thr-1/messages': {
        status: 409,
        body: { error: { code: 'thread_busy', message: 'An answer is pending' } },
      },
    })

    await expect(gateway.ask(grs1(), 'thr-1', { content: 'Why?' })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'thread_busy' },
    })
  })

  it('sends an edit with the revision it was made against', async () => {
    const { gateway, calls } = gatewayOver({
      'PATCH /api/v1/guided-reviews/grs-1/comment-drafts/drf-1': {
        body: { id: 'drf-1', rev: 2 },
      },
    })

    await gateway.editDraft(grs1(), 'drf-1', { rev: 1, body: 'Tighter' })

    expect(calls[0]?.body).toEqual({ rev: 1, body: 'Tighter' })
  })

  it('refuses a post on a moved head with the reason that says to refresh', async () => {
    const { gateway } = gatewayOver({
      'POST /api/v1/guided-reviews/grs-1/comment-drafts/post': {
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'The pull request moved',
            details: { reason: 'session_stale' },
          },
        },
      },
    })

    await expect(gateway.postDrafts(grs1(), { draftIds: ['drf-1'] })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'session_stale' },
    })
  })

  it("relays cat-factory's stream as state frames, and stops at its cap", async () => {
    const sse = [
      `event: state\ndata: ${JSON.stringify(view())}\n\n`,
      ': keep-alive\n\n',
      'event: timeout\ndata: {}\n\n',
      `event: state\ndata: ${JSON.stringify(view({ id: 'after-the-cap' }))}\n\n`,
    ].join('')
    const gateway = new CatFactoryGuidedReviewGateway({
      baseUrl: 'https://cat-factory.example.com',
      apiKey: 'cf_live_key.secret',
      fetch: async () =>
        new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    })

    const events = []
    for await (const event of gateway.watch(grs1(), new AbortController().signal)) {
      events.push(event)
    }

    expect(events.map((event) => event.kind)).toStrictEqual(['state', 'timeout'])
    expect(events[0]).toMatchObject({ view: { session: { id: 'grs-1' } } })
  })

  it('names the `write` scope when the key is too weak', async () => {
    const { gateway } = gatewayOver({
      'POST /api/v1/guided-reviews': {
        status: 403,
        body: { error: { code: 'insufficient_scope', message: 'needs write' } },
      },
    })

    await expect(gateway.open(target, [])).rejects.toMatchObject({
      code: 'forbidden',
      message: /`write` scope/,
    })
  })
})

/** The key the directory sync mirrors a repository under in one workspace. */
function keyIn(workspaceId: string, repoId: number): string {
  return entityKey({ entityType: 'repo', workspaceId, entityId: String(repoId) })
}

const noSessions = { body: { sessions: [], nextCursor: null } }

describe('CatFactoryGuidedReviewGateway workspaces', () => {
  it('names no workspace for a repository the mirror lists nowhere, as a single-workspace key expects', async () => {
    const { gateway, calls } = gatewayOver({ 'GET /api/v1/guided-reviews': noSessions })

    await gateway.find(target, [])
    await gateway.editDraft(grs1(), 'drf-1', { rev: 1, body: 'x' }).catch(() => null)

    expect(calls.map((call) => call.workspace)).toStrictEqual([null, null])
  })

  it('looks up and reads a session in the workspace that links the repository', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-b GET /api/v1/guided-reviews': { body: { sessions: [session()], nextCursor: null } },
      'ws-b GET /api/v1/guided-reviews/grs-1': { body: view() },
    })

    await expect(gateway.find(target, [keyIn('ws-b', 42)])).resolves.toMatchObject({
      session: { id: 'grs-1' },
    })
    expect(calls.map((call) => call.workspace)).toStrictEqual(['ws-b', 'ws-b'])
  })

  it('opens in the first workspace by id, after finding no session in any that links the repository', async () => {
    const { gateway, calls } = gatewayOver({
      'GET /api/v1/guided-reviews': noSessions,
      'ws-a POST /api/v1/guided-reviews': { body: view() },
    })

    await gateway.open(target, [keyIn('ws-b', 1), keyIn('ws-a', 2)])

    expect(calls.map((call) => `${call.workspace} ${call.method}`).toSorted()).toStrictEqual([
      'ws-a GET',
      'ws-a POST',
      'ws-b GET',
    ])
    expect(calls.at(-1)).toMatchObject({ workspace: 'ws-a', method: 'POST' })
  })

  it('answers the session already open in another linking workspace instead of opening a second', async () => {
    const { gateway, calls } = gatewayOver({
      'GET /api/v1/guided-reviews': noSessions,
      'ws-b GET /api/v1/guided-reviews': { body: { sessions: [session()], nextCursor: null } },
      'ws-b GET /api/v1/guided-reviews/grs-1': { body: view() },
    })

    await expect(gateway.open(target, [keyIn('ws-a', 1), keyIn('ws-b', 2)])).resolves.toMatchObject(
      { session: { id: 'grs-1' } },
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('opens nothing while a linking workspace refuses the lookup, since it may hold the session', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-a GET /api/v1/guided-reviews': {
        status: 403,
        body: { error: { code: 'forbidden', message: 'not a member' } },
      },
      'ws-b GET /api/v1/guided-reviews': noSessions,
    })

    await expect(gateway.open(target, [keyIn('ws-a', 1), keyIn('ws-b', 2)])).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('names the one linking workspace on a call by session id, without reading the session first', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-a PATCH /api/v1/guided-reviews/grs-1/comment-drafts/drf-1': { body: { id: 'drf-1' } },
    })

    await gateway.editDraft(grs1([keyIn('ws-a', 1)]), 'drf-1', { rev: 1, body: 'Tighter' })

    expect(calls.map((call) => `${call.workspace} ${call.method}`)).toStrictEqual(['ws-a PATCH'])
  })

  it('finds which linking workspace holds a session once, and asks there after', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-b GET /api/v1/guided-reviews/grs-1': { body: view() },
      'ws-b POST /api/v1/guided-reviews/grs-1/threads/thr-1/messages': {
        body: { thread: { id: 'thr-1' } },
      },
    })
    const linked = grs1([keyIn('ws-a', 1), keyIn('ws-b', 2)])

    await expect(gateway.get(linked)).resolves.toMatchObject({ session: { id: 'grs-1' } })
    await gateway.ask(linked, 'thr-1', { content: 'Why?' })

    expect(calls.map((call) => `${call.workspace} ${call.method}`)).toStrictEqual([
      'ws-a GET',
      'ws-b GET',
      'ws-b POST',
    ])
  })

  it('takes the workspace that answered with the session over one that refused the read', async () => {
    const { gateway } = gatewayOver({
      'ws-a GET /api/v1/guided-reviews/grs-1': {
        status: 403,
        body: { error: { code: 'forbidden', message: 'not a member' } },
      },
      'ws-b GET /api/v1/guided-reviews/grs-1': { body: view() },
    })

    await expect(gateway.get(grs1([keyIn('ws-a', 1), keyIn('ws-b', 2)]))).resolves.toMatchObject({
      session: { id: 'grs-1' },
    })
  })

  it('passes a refusal through when no workspace answered with the session', async () => {
    const { gateway } = gatewayOver({
      'ws-a GET /api/v1/guided-reviews/grs-1': {
        status: 401,
        body: { error: { code: 'unauthorized', message: 'revoked' } },
      },
    })

    await expect(gateway.get(grs1([keyIn('ws-a', 1), keyIn('ws-b', 2)]))).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('reads as not found when no linking workspace holds the session', async () => {
    const { gateway } = gatewayOver({})

    await expect(gateway.get(grs1([keyIn('ws-a', 1), keyIn('ws-b', 2)]))).rejects.toMatchObject({
      code: 'not_found',
      details: { upstream: 'cat-factory' },
    })
  })
})

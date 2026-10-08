import { describe, expect, it } from 'vitest'
import { CatFactoryGuidedReviewGateway } from './CatFactoryGuidedReviewGateway.js'

interface Call {
  method: string
  path: string
  query: string
  body: unknown
}

type Answer = { status?: number; body: unknown }

/** A gateway over canned answers, keyed by `METHOD path`, recording every call it makes. */
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
      calls.push({
        method,
        path: url.pathname,
        query: url.search,
        body: typeof raw === 'string' ? JSON.parse(raw) : null,
      })
      const answer = routes[`${method} ${url.pathname}`] ?? {
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

    await expect(gateway.find(target)).resolves.toMatchObject({ session: { id: 'grs-1' } })
    expect(calls[0]?.query).toContain('prNumber=7')
    expect(calls[0]?.query).toContain('mine=true')
  })

  it('finds nothing, and opens nothing, for a pull request without a session', async () => {
    const { gateway, calls } = gatewayOver({
      'GET /api/v1/guided-reviews': { body: { sessions: [], nextCursor: null } },
    })

    await expect(gateway.find(target)).resolves.toBeNull()
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })

  it('opens a session by the coordinates cat-factory addresses a pull request with', async () => {
    const { gateway, calls } = gatewayOver({ 'POST /api/v1/guided-reviews': { body: view() } })

    await gateway.open(target)

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

    await expect(gateway.open(target)).rejects.toMatchObject({
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

    await expect(gateway.ask('grs-1', 'thr-1', { content: 'Why?' })).rejects.toMatchObject({
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

    await gateway.editDraft('grs-1', 'drf-1', { rev: 1, body: 'Tighter' })

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

    await expect(gateway.postDrafts('grs-1', { draftIds: ['drf-1'] })).rejects.toMatchObject({
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
    for await (const event of gateway.watch('grs-1', new AbortController().signal)) {
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

    await expect(gateway.open(target)).rejects.toMatchObject({
      code: 'forbidden',
      message: /`write` scope/,
    })
  })
})

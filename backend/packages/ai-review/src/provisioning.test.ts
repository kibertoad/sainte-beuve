import { CatFactoryClient } from '@cat-factory/sdk'
import { describe, expect, it } from 'vitest'
import { provisionService } from './provisioning.js'
import { WorkspaceClients } from './workspaceClients.js'

// Through the SDK's own `fetch` seam, like the gateway's suite: what is under
// test is which calls go to which workspace, on the wire shape the SDK decodes.

const PULL_REQUEST = {
  provider: 'github' as const,
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

interface Call {
  method: string
  path: string
  workspace: string | null
  body: unknown
}

/** Answers keyed by `METHOD path`; anything else is a 404. */
function clientsOver(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = init?.method ?? 'GET'
    const path = new URL(String(input)).pathname
    const raw = init?.body
    calls.push({
      method,
      path,
      workspace: new Headers(init?.headers).get('x-cat-factory-workspace'),
      body: typeof raw === 'string' ? JSON.parse(raw) : null,
    })
    const route = routes[`${method} ${path}`]
    return new Response(
      JSON.stringify(route?.body ?? { error: { code: 'not_found', message: path } }),
      {
        status: route === undefined ? 404 : (route.status ?? 200),
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  const clients = new WorkspaceClients(
    (workspaceId) =>
      new CatFactoryClient({
        baseUrl: 'https://cat-factory.example.com',
        apiKey: 'cf_live_key.secret',
        fetch,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }),
  )
  return { clients, calls }
}

function linkedRepo(overrides: Record<string, unknown> = {}) {
  return {
    defaultBranch: 'main',
    linkedElsewhere: false,
    monorepo: false,
    name: 'sainte-beuve',
    owner: 'kibertoad',
    private: false,
    provider: 'github',
    repoId: 42,
    serviceId: null,
    ...overrides,
  }
}

const CREATED = {
  serviceId: 'svc-new',
  title: 'sainte-beuve',
  description: '',
  status: 'planned',
  type: 'service',
}

describe('provisionService', () => {
  it('links into the workspace most of the owner repositories sit in, then creates a service', async () => {
    const { clients, calls } = clientsOver({
      'POST /api/v1/repos/link': { body: linkedRepo() },
      'POST /api/v1/services': { body: CREATED },
    })

    const placement = await provisionService(clients, {
      pullRequest: PULL_REQUEST,
      ownerDirectoryKeys: ['ws-b/7', 'ws-a/8', 'ws-a/9'],
    })

    expect(placement).toStrictEqual({ serviceId: 'svc-new', workspaceId: 'ws-a' })
    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: '/api/v1/repos/link',
        workspace: 'ws-a',
        body: { owner: 'kibertoad', name: 'sainte-beuve' },
      },
      {
        method: 'POST',
        path: '/api/v1/services',
        workspace: 'ws-a',
        body: { title: 'sainte-beuve', repo: { repoId: 42 } },
      },
    ])
  })

  it("uses the key's only workspace, and the service linking found, without creating one", async () => {
    const { clients, calls } = clientsOver({
      'GET /api/v1/directory/reach': { body: { accountId: 'acc-1', workspaceIds: ['ws-only'] } },
      'POST /api/v1/repos/link': { body: linkedRepo({ serviceId: 'svc-42' }) },
    })

    const placement = await provisionService(clients, {
      pullRequest: PULL_REQUEST,
      ownerDirectoryKeys: [],
    })

    expect(placement).toStrictEqual({ serviceId: 'svc-42', workspaceId: 'ws-only' })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toStrictEqual([
      'GET /api/v1/directory/reach',
      'POST /api/v1/repos/link',
    ])
  })

  it('falls back when the key reaches several workspaces and nothing says which', async () => {
    const { clients, calls } = clientsOver({
      'GET /api/v1/directory/reach': {
        body: { accountId: 'acc-1', workspaceIds: ['ws-a', 'ws-b'] },
      },
    })

    expect(
      await provisionService(clients, { pullRequest: PULL_REQUEST, ownerDirectoryKeys: [] }),
    ).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('falls back for a monorepo, whose services are per directory', async () => {
    const { clients, calls } = clientsOver({
      'POST /api/v1/repos/link': { body: linkedRepo({ monorepo: true }) },
    })

    expect(
      await provisionService(clients, {
        pullRequest: PULL_REQUEST,
        ownerDirectoryKeys: ['ws-a/8'],
      }),
    ).toBeNull()
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/repos/link'])
  })

  it('falls back when the key may link but not create a service', async () => {
    const { clients } = clientsOver({
      'POST /api/v1/repos/link': { body: linkedRepo() },
      'POST /api/v1/services': {
        status: 403,
        body: { error: { code: 'insufficient_scope', message: 'needs admin' } },
      },
    })

    expect(
      await provisionService(clients, {
        pullRequest: PULL_REQUEST,
        ownerDirectoryKeys: ['ws-a/8'],
      }),
    ).toBeNull()
  })

  it('refuses a repository the connection cannot reach', async () => {
    const { clients } = clientsOver({
      'POST /api/v1/repos/link': {
        status: 404,
        body: {
          error: {
            code: 'not_found',
            message: 'not reachable',
            details: { reason: 'repo_not_reachable' },
          },
        },
      },
    })

    await expect(
      provisionService(clients, { pullRequest: PULL_REQUEST, ownerDirectoryKeys: ['ws-a/8'] }),
    ).rejects.toMatchObject({ details: { reason: 'repo_not_reachable' } })
  })
})

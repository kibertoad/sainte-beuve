import type { ExternalRepositoryEntry, RepositoryDirectoryStore } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { CatFactoryDirectoryGateway } from './CatFactoryDirectoryGateway.js'

const NOW = 1_800_000_000_000

function memoryStore(): RepositoryDirectoryStore & {
  entries: Map<string, ExternalRepositoryEntry>
} {
  const entries = new Map<string, ExternalRepositoryEntry>()
  let cursor: number | null = null
  return {
    entries,
    getCursor: async () => cursor,
    setCursor: async (seq) => {
      cursor = seq
    },
    apply: async (entry) => {
      const held = entries.get(entry.key)
      if (held === undefined || held.seq <= entry.seq) entries.set(entry.key, entry)
    },
    liveKeys: async () =>
      [...entries.values()].filter((e) => e.repository !== null).map((e) => e.key),
  }
}

const repo = {
  workspaceId: 'ws_1',
  repoId: 101,
  provider: 'github',
  owner: 'acme',
  name: 'payments',
  defaultBranch: 'main',
  private: true,
  monorepo: false,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** An account whose directory holds one workspace, one user and one linked repository. */
function directoryAnswering(changes: unknown[] = []): typeof globalThis.fetch {
  const page = (items: unknown[]) => json({ items, nextCursor: null, asOfSeq: 5 })
  const routes: Record<string, () => Response> = {
    '/api/v1/directory/workspaces': () =>
      page([{ id: 'ws_1', name: 'Core', description: null, accessMode: 'account' }]),
    '/api/v1/directory/users': () =>
      page([{ id: 'u1', name: 'Ada', email: null, avatarUrl: null }]),
    '/api/v1/directory/account-memberships': () => page([]),
    '/api/v1/directory/workspace-memberships': () => page([]),
    '/api/v1/directory/repos': () => page([repo]),
    '/api/v1/directory/changes': () =>
      json({ changes, nextAfter: 5 + changes.length, headSeq: 5 + changes.length }),
  }
  return async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    return routes[path]?.() ?? json({ error: { code: 'not_found', message: path } }, 404)
  }
}

function gateway(fetch: typeof globalThis.fetch): CatFactoryDirectoryGateway {
  return new CatFactoryDirectoryGateway({
    baseUrl: 'http://cat-factory.example',
    apiKey: 'cf_live_key.secret',
    fetch,
    now: () => NOW,
  })
}

describe('CatFactoryDirectoryGateway', () => {
  it('keeps the linked repositories from a first sync, and nothing else', async () => {
    const store = memoryStore()
    const report = await gateway(directoryAnswering()).catchUp(store)
    expect(report).toEqual({ cursor: 5, reconciled: true })
    expect([...store.entries.values()]).toEqual([
      {
        key: 'ws_1/101',
        seq: 5,
        repository: { provider: 'github', owner: 'acme', repo: 'payments', id: '101' },
      },
    ])
  })

  it('applies an unlink from the feed as a dropped entry', async () => {
    const store = memoryStore()
    await store.setCursor(5)
    await store.apply({
      key: 'ws_1/101',
      seq: 5,
      repository: { provider: 'github', owner: 'acme', repo: 'payments', id: '101' },
    })
    const unlinked = {
      seq: 6,
      at: NOW,
      workspaceId: 'ws_1',
      entityId: '101',
      entityType: 'repo',
      entity: null,
    }
    await gateway(directoryAnswering([unlinked])).catchUp(store)
    expect(store.entries.get('ws_1/101')).toEqual({ key: 'ws_1/101', seq: 6, repository: null })
  })

  it('refuses a push whose signature does not verify, and writes nothing', async () => {
    const store = memoryStore()
    const outcome = await gateway(directoryAnswering()).receive(store, {
      headers: new Headers({
        'x-cat-factory-timestamp': String(NOW),
        'x-cat-factory-signature': `v1=${'0'.repeat(64)}`,
      }),
      rawBody: '{"event":"directory.changed","changes":[]}',
      secret: 'a-secret-of-sixteen-or-more',
    })
    expect(outcome).toEqual({ ok: false, reason: 'bad_signature' })
    expect(store.entries.size).toBe(0)
  })
})

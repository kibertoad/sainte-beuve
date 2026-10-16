import type {
  DirectoryMirrorStore,
  ExternalDirectoryEntryInput,
  ExternalRepositoryEntry,
} from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { CatFactoryDirectoryGateway } from './CatFactoryDirectoryGateway.js'

const NOW = 1_800_000_000_000

function memoryStore(): DirectoryMirrorStore & {
  entries: Map<string, ExternalRepositoryEntry>
  directory: Map<string, ExternalDirectoryEntryInput>
} {
  const entries = new Map<string, ExternalRepositoryEntry>()
  const directory = new Map<string, ExternalDirectoryEntryInput>()
  let cursor: number | null = null
  return {
    entries,
    directory,
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
    applyDirectory: async (entry) => {
      const key = `${entry.kind}:${entry.key}`
      const held = directory.get(key)
      if (held === undefined || held.seq <= entry.seq) directory.set(key, entry)
    },
    liveDirectoryKeys: async (kind) =>
      [...directory.values()].filter((e) => e.kind === kind && e.record !== null).map((e) => e.key),
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

/**
 * An account whose directory holds one workspace, two users in it and one
 * linked repository. Ada carries the host accounts newer instances publish;
 * Grace comes from an instance that predates them.
 */
function directoryAnswering(changes: unknown[] = []): typeof globalThis.fetch {
  const page = (items: unknown[]) => json({ items, nextCursor: null, asOfSeq: 5 })
  const ada = {
    id: 'u1',
    name: 'Ada',
    email: null,
    avatarUrl: null,
    accounts: [
      { provider: 'github', id: '583231', login: 'ada' },
      { provider: 'bitbucket', id: '7', login: 'ada' },
    ],
  }
  const grace = { id: 'u2', name: 'Grace', email: null, avatarUrl: null }
  const membership = (userId: string) => ({
    workspaceId: 'ws_1',
    userId,
    role: 'member',
    createdAt: 1,
  })
  const routes: Record<string, () => Response> = {
    '/api/v1/directory/workspaces': () =>
      page([{ id: 'ws_1', name: 'Core', description: null, accessMode: 'account' }]),
    '/api/v1/directory/users': () => page([ada, grace]),
    '/api/v1/directory/account-memberships': () => page([]),
    '/api/v1/directory/workspace-memberships': () => page([membership('u1'), membership('u2')]),
    '/api/v1/directory/repos': () => page([repo]),
    '/api/v1/me': () => json(identity(null)),
    '/api/v1/directory/changes': () =>
      json({ changes, nextAfter: 5 + changes.length, headSeq: 5 + changes.length }),
  }
  return async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    return routes[path]?.() ?? json({ error: { code: 'not_found', message: path } }, 404)
  }
}

function identity(workspaceIds: string[] | null) {
  return {
    accountId: 'acc_1',
    createdAt: 1,
    externalIdentity: null,
    keyId: 'key_1',
    label: 'sainte-beuve',
    scope: 'admin',
    workspaceId: 'ws_1',
    workspaceIds,
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
  it('keeps the linked repositories from a first sync', async () => {
    const store = memoryStore()
    const report = await gateway(directoryAnswering()).catchUp(store)
    expect(report).toEqual({ cursor: 5, reconciled: true, reach: 'account' })
    expect([...store.entries.values()]).toEqual([
      {
        key: 'ws_1/101',
        seq: 5,
        repository: { provider: 'github', owner: 'acme', repo: 'payments', id: '101' },
      },
    ])
  })

  it('keeps users, workspaces and memberships as people, groups and memberships', async () => {
    const store = memoryStore()
    await gateway(directoryAnswering()).catchUp(store)
    const entry = (key: string) => store.directory.get(key)
    // A host this build does not know is skipped, never guessed onto one it does.
    expect(entry('person:u1')?.record).toEqual({
      id: 'u1',
      name: 'Ada',
      accounts: [{ provider: 'github', subject: '583231', username: 'ada' }],
    })
    expect(entry('person:u2')?.record).toEqual({ id: 'u2', name: 'Grace', accounts: [] })
    expect(entry('group:ws_1')?.record).toEqual({ id: 'ws_1', name: 'Core' })
    const memberships = [...store.directory.values()].filter((e) => e.kind === 'membership')
    expect(memberships.map((e) => e.record)).toEqual([
      { groupId: 'ws_1', personId: 'u1' },
      { groupId: 'ws_1', personId: 'u2' },
    ])
  })

  it('reports a key limited to some workspaces, which is listed no users', async () => {
    const store = memoryStore()
    const answering = directoryAnswering()
    const restricted: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname
      if (path === '/api/v1/me') return json(identity(['ws_1']))
      if (path === '/api/v1/directory/users') {
        const refusal = {
          code: 'forbidden',
          message: 'account-wide',
          details: { reason: 'account_scope_required' },
        }
        return json({ error: refusal }, 403)
      }
      return answering(input, init)
    }
    const report = await gateway(restricted).reconcile(store)
    expect(report.reach).toBe('workspaces')
    expect([...store.directory.values()].filter((e) => e.kind === 'person')).toEqual([])
    expect(store.directory.get('group:ws_1')?.record).toEqual({ id: 'ws_1', name: 'Core' })
  })

  it('reports no reach when it only followed the feed', async () => {
    const store = memoryStore()
    await store.setCursor(5)
    expect((await gateway(directoryAnswering()).catchUp(store)).reach).toBeNull()
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

  it('says which field cat-factory refused when it turns a webhook away', async () => {
    const refusing = async () =>
      json(
        {
          error: {
            code: 'validation',
            message: 'Request failed validation',
            issues: [{ path: 'url', message: 'The webhook endpoint must be an https:// URL' }],
          },
        },
        400,
      )
    await expect(
      gateway(refusing).registerWebhook({
        webhookId: 'sainte-beuve-1',
        url: 'http://localhost:8788/webhooks/cat-factory/default',
        secret: 'a-secret-of-sixteen-or-more',
      }),
    ).rejects.toThrow('(url: The webhook endpoint must be an https:// URL)')
  })

  it('names the reach, not the scope, when a key limited to some workspaces is turned away', async () => {
    const refusing = async () =>
      json(
        {
          error: {
            code: 'forbidden',
            message: 'Directory webhooks need a key that reaches every workspace',
            details: { reason: 'account_scope_required' },
          },
        },
        403,
      )
    const refusal = gateway(refusing).registerWebhook({
      webhookId: 'sainte-beuve-1',
      url: 'https://reviews.example.com/webhooks/cat-factory/default',
      secret: 'a-secret-of-sixteen-or-more',
    })
    await expect(refusal).rejects.toThrow(/reach is all workspaces/)
    await expect(refusal).rejects.not.toThrow(/scope/)
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

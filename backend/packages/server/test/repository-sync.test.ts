import type { CatFactoryConnection, Project } from '@sainte-beuve/contracts'
import type {
  ExternalRepositoryEntry,
  GuidedReviewGateway,
  RepositoryDirectoryGateway,
  RepositoryDirectoryStore,
} from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { runReminderTick } from '../src/reminders/tick.js'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import {
  buildHarness,
  del,
  get,
  patch,
  post,
  put,
  stubGateways,
  type TestHarness,
} from './helpers.js'

const PUSH_PATH = '/webhooks/cat-factory/default'
const SYNC_PATH = '/api/v1/settings/connections/cat-factory/sync'

function linked(key: string, repo: string, id = key.split('/')[1] ?? key): ExternalRepositoryEntry {
  return { key, seq: 0, repository: { provider: 'github', owner: 'acme', repo, id } }
}

/**
 * A directory listing whatever `listing` holds when asked, applied to the store
 * the way the real syncer applies a snapshot: what it lists is written, what it
 * no longer lists is dropped. A push verifies when its signature is `v1=good`.
 */
function directory(listing: ExternalRepositoryEntry[]) {
  let seq = 0
  const registered: { webhookId: string; url: string; secret: string }[] = []
  const removed: string[] = []
  const sync = async (store: RepositoryDirectoryStore, reconciled: boolean) => {
    seq += 1
    const listed = new Set(listing.map((entry) => entry.key))
    for (const key of await store.liveKeys()) {
      if (!listed.has(key)) await store.apply({ key, seq, repository: null })
    }
    for (const entry of listing) await store.apply({ ...entry, seq })
    await store.setCursor(seq)
    return { cursor: seq, reconciled }
  }
  const gateway: RepositoryDirectoryGateway = {
    catchUp: (store) => sync(store, false),
    reconcile: (store) => sync(store, true),
    receive: async (store, delivery) =>
      delivery.headers.get('x-cat-factory-signature') === 'v1=good'
        ? { ok: true, event: 'directory.changed', sync: await sync(store, false) }
        : { ok: false, reason: 'bad_signature' },
    registerWebhook: async (input) => {
      registered.push(input)
    },
    removeWebhook: async (webhookId) => {
      removed.push(webhookId)
    },
  }
  return { gateway, listing, registered, removed }
}

async function syncing(
  listing: ExternalRepositoryEntry[],
): Promise<{ harness: TestHarness } & ReturnType<typeof directory>> {
  const fake = directory(listing)
  const wired = catFactoryWired({})
  const harness = buildHarness({
    ...wired,
    apiBaseUrl: 'https://reviews.example.com',
    gateways: stubGateways({
      aiReview: () => stubAiReview(),
      guidedReview: () => ({}) as GuidedReviewGateway,
      catFactoryDirectory: () => fake.gateway,
    }),
  })
  return { harness: await connectCatFactory(harness), ...fake }
}

async function projects(harness: TestHarness): Promise<Project[]> {
  const res = await harness.app.fetch(get('/api/v1/projects'))
  return ((await res.json()) as { projects: Project[] }).projects
}

function names(list: readonly Project[]): string[] {
  return list.map((p) => `${p.owner}/${p.repo}`).sort()
}

function push(signature: string): Request {
  return new Request(`http://localhost${PUSH_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cat-factory-timestamp': '1',
      'x-cat-factory-signature': signature,
    },
    body: '{"event":"directory.changed"}',
  })
}

describe('repositories from cat-factory', () => {
  it('registers what the directory links, once per repository, on the first tick', async () => {
    const { harness } = await syncing([
      linked('ws_1/101', 'payments'),
      linked('ws_2/101', 'payments'),
      linked('ws_1/102', 'billing'),
    ])
    expect(await runReminderTick(harness.container)).toMatchObject({ repositoriesSynced: 2 })
    const listed = await projects(harness)
    expect(names(listed)).toEqual(['acme/billing', 'acme/payments'])
    expect(listed.find((p) => p.repo === 'payments')?.external).toEqual({
      source: 'cat-factory',
      id: '101',
    })
  })

  it('refuses adding or removing a repository here while cat-factory decides', async () => {
    const { harness } = await syncing([linked('ws_1/101', 'payments')])
    await runReminderTick(harness.container)
    const added = await harness.app.fetch(
      post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'other' }),
    )
    expect(added.status).toBe(409)
    const [project] = await projects(harness)
    const removed = await harness.app.fetch(del(`/api/v1/projects/${project?.id}`))
    expect(removed.status).toBe(409)
    const edited = await harness.app.fetch(
      patch(`/api/v1/projects/${project?.id}`, { skills: ['Go'] }),
    )
    expect(edited.status).toBe(200)
  })

  it('keeps a project through a rename, and drops it once unlinked', async () => {
    const fake = await syncing([linked('ws_1/101', 'payments')])
    await runReminderTick(fake.harness.container)
    const [before] = await projects(fake.harness)
    await fake.harness.app.fetch(patch(`/api/v1/projects/${before?.id}`, { skills: ['Go'] }))

    fake.listing.splice(0, 1, linked('ws_1/101', 'payments-api'))
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    const [after] = await projects(fake.harness)
    expect(after).toMatchObject({ id: before?.id, repo: 'payments-api', skills: ['Go'] })

    fake.listing.splice(0, 1)
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    expect(await projects(fake.harness)).toEqual([])
  })

  it('adopts a repository already registered here, and drops one cat-factory does not link', async () => {
    const fake = directory([linked('ws_1/101', 'payments')])
    const harness = buildHarness({
      ...catFactoryWired({}),
      gateways: stubGateways({
        aiReview: () => stubAiReview(),
        guidedReview: () => ({}) as GuidedReviewGateway,
        catFactoryDirectory: () => fake.gateway,
      }),
    })
    for (const repo of ['payments', 'legacy']) {
      await harness.app.fetch(post('/api/v1/projects', { provider: 'github', owner: 'acme', repo }))
    }
    const [payments] = (await projects(harness)).filter((p) => p.repo === 'payments')
    await connectCatFactory(harness)
    await runReminderTick(harness.container)
    const [adopted, ...rest] = await projects(harness)
    expect(rest).toEqual([])
    expect(adopted).toMatchObject({ id: payments?.id, external: { source: 'cat-factory' } })
  })

  it('removes nothing while the directory has never listed a repository, and says why', async () => {
    const fake = directory([])
    const harness = buildHarness({
      ...catFactoryWired({}),
      apiBaseUrl: 'https://reviews.example.com',
      gateways: stubGateways({
        aiReview: () => stubAiReview(),
        guidedReview: () => ({}) as GuidedReviewGateway,
        catFactoryDirectory: () => fake.gateway,
      }),
    })
    await harness.app.fetch(
      post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'payments' }),
    )
    await connectCatFactory(harness)
    const res = await harness.app.fetch(post(SYNC_PATH, {}))
    const connection = (await res.json()) as CatFactoryConnection
    expect(names(await projects(harness))).toEqual(['acme/payments'])
    expect(connection.repositorySync?.error).toMatch(/no project was removed/)
  })

  it('asks cat-factory to push to this org, and reports that it did', async () => {
    const { harness, registered } = await syncing([])
    const res = await harness.app.fetch(post(SYNC_PATH, {}))
    const connection = (await res.json()) as CatFactoryConnection
    expect(res.status).toBe(200)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.url).toBe(`https://reviews.example.com${PUSH_PATH}`)
    expect(registered[0]?.webhookId).toMatch(/^sainte-beuve-[0-9a-f]{16}$/)
    expect(connection.repositorySync).toMatchObject({
      webhook: 'registered',
      webhookUrl: `https://reviews.example.com${PUSH_PATH}`,
      error: null,
    })
  })

  it('moves the webhook when this deployment moves to another address', async () => {
    const fake = await syncing([])
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    Object.assign(fake.harness.container, { apiBaseUrl: 'https://moved.example.com' })
    fake.harness.clock.advance(24 * 60 * 60_000)
    await runReminderTick(fake.harness.container)
    expect(fake.registered.map((r) => r.url)).toEqual([
      `https://reviews.example.com${PUSH_PATH}`,
      `https://moved.example.com${PUSH_PATH}`,
    ])
    expect(fake.removed).toEqual([fake.registered[0]?.webhookId])
  })

  it('applies a verified push, and refuses an unverified one alike for every reason', async () => {
    const fake = await syncing([])
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    fake.listing.push(linked('ws_1/101', 'payments'))

    expect((await fake.harness.app.fetch(push('v1=bad'))).status).toBe(403)
    expect(await projects(fake.harness)).toEqual([])
    const unknownOrg = new Request(
      push('v1=good').url.replace('default', 'nobody'),
      push('v1=good'),
    )
    expect((await fake.harness.app.fetch(unknownOrg)).status).toBe(403)

    expect((await fake.harness.app.fetch(push('v1=good'))).status).toBe(204)
    expect(names(await projects(fake.harness))).toEqual(['acme/payments'])
  })

  it('starts the directory over when the key is replaced, since it may reach another account', async () => {
    const fake = await syncing([linked('ws_1/101', 'payments')])
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    const replaced = await fake.harness.app.fetch(
      put('/api/v1/settings/integrations/cat-factory/token', { token: 'cf_live_other.secret' }),
    )
    expect(replaced.status).toBe(200)
    expect(fake.removed).toEqual([fake.registered[0]?.webhookId])
    expect(
      await fake.harness.container.repositories.externalRepositories.list('cat-factory'),
    ).toEqual([])
    const res = await fake.harness.app.fetch(get('/api/v1/settings/connections'))
    const { catFactory } = (await res.json()) as { catFactory: CatFactoryConnection }
    expect(catFactory.repositorySync).toMatchObject({ webhook: 'pending', syncedAt: null })
  })

  it('hands the repositories back to the admins when cat-factory is cleared', async () => {
    const fake = await syncing([linked('ws_1/101', 'payments')])
    await fake.harness.app.fetch(post(SYNC_PATH, {}))
    await fake.harness.app.fetch(del('/api/v1/settings/connections/cat-factory'))
    expect(fake.removed).toEqual([fake.registered[0]?.webhookId])
    expect(names(await projects(fake.harness))).toEqual(['acme/payments'])
    expect(
      await fake.harness.container.repositories.externalRepositories.list('cat-factory'),
    ).toEqual([])
    const added = await fake.harness.app.fetch(
      post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'other' }),
    )
    expect(added.status).toBe(201)
  })
})

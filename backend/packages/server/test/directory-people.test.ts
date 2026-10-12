import type { CatFactoryConnection, ExternalPerson, Reviewer, Team } from '@sainte-beuve/contracts'
import type {
  DirectoryMirrorStore,
  ExternalDirectoryEntryInput,
  GuidedReviewGateway,
  RepositoryDirectoryGateway,
} from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import {
  addReviewer,
  buildHarness,
  get,
  patch,
  post,
  stubGateways,
  type TestHarness,
} from './helpers.js'

const SYNC_PATH = '/api/v1/settings/connections/cat-factory/sync'

interface Listing {
  persons: ExternalPerson[]
  groups: { id: string; name: string }[]
  memberships: { groupId: string; personId: string }[]
}

function ada(accounts = true): ExternalPerson {
  return {
    id: 'usr_ada',
    name: 'Ada Lovelace',
    accounts: accounts ? [{ provider: 'github', subject: '583231', username: 'ada' }] : [],
  }
}

/**
 * A directory listing whatever `listing` holds when asked, applied the way the
 * real syncer applies a snapshot: what it lists is written, what it no longer
 * lists is dropped. It links no repositories.
 */
function directory(listing: Listing) {
  let seq = 0
  const entries = (): ExternalDirectoryEntryInput[] => [
    ...listing.persons.map((record) => ({ kind: 'person' as const, key: record.id, seq, record })),
    ...listing.groups.map((record) => ({ kind: 'group' as const, key: record.id, seq, record })),
    ...listing.memberships.map((record) => ({
      kind: 'membership' as const,
      key: `${record.groupId}/${record.personId}`,
      seq,
      record,
    })),
  ]
  const sync = async (store: DirectoryMirrorStore) => {
    seq += 1
    const listed = entries()
    for (const kind of ['person', 'group', 'membership'] as const) {
      const keys = new Set(listed.filter((e) => e.kind === kind).map((e) => e.key))
      for (const key of await store.liveDirectoryKeys(kind)) {
        if (!keys.has(key)) await store.applyDirectory({ kind, key, seq, record: null })
      }
    }
    for (const entry of listed) await store.applyDirectory(entry)
    await store.setCursor(seq)
    return { cursor: seq, reconciled: true }
  }
  const gateway: RepositoryDirectoryGateway = {
    catchUp: sync,
    reconcile: sync,
    receive: async () => ({ ok: false, reason: 'unused' }),
    registerWebhook: async () => {},
    removeWebhook: async () => {},
  }
  return gateway
}

async function syncing(listing: Listing): Promise<TestHarness> {
  const harness = buildHarness({
    ...catFactoryWired({}),
    apiBaseUrl: 'https://reviews.example.com',
    gateways: stubGateways({
      aiReview: () => stubAiReview(),
      guidedReview: () => ({}) as GuidedReviewGateway,
      catFactoryDirectory: () => directory(listing),
    }),
  })
  return harness
}

async function sync(harness: TestHarness): Promise<CatFactoryConnection> {
  const res = await harness.app.fetch(post(SYNC_PATH, {}))
  expect(res.status).toBe(200)
  return (await res.json()) as CatFactoryConnection
}

async function reviewers(harness: TestHarness): Promise<Reviewer[]> {
  const res = await harness.app.fetch(get('/api/v1/reviewers'))
  return ((await res.json()) as { reviewers: Reviewer[] }).reviewers
}

async function teams(harness: TestHarness): Promise<Team[]> {
  const res = await harness.app.fetch(get('/api/v1/teams'))
  return ((await res.json()) as { teams: Team[] }).teams
}

const core = { id: 'ws_core', name: 'Core' }

describe('people and teams from cat-factory', () => {
  it('turns workspaces into teams, and counts people it cannot match', async () => {
    const harness = await syncing({ persons: [ada(false)], groups: [core], memberships: [] })
    await connectCatFactory(harness)
    const connection = await sync(harness)
    expect((await teams(harness)).map((t) => [t.name, t.external])).toEqual([
      ['Core', { source: 'cat-factory', id: 'ws_core' }],
    ])
    expect(await reviewers(harness)).toEqual([])
    expect(connection.repositorySync?.people).toEqual({ listed: 1, linked: 0, withoutAccount: 1 })
  })

  it('follows the reviewer with that GitHub handle, and links the account to them', async () => {
    const harness = await syncing({
      persons: [ada()],
      groups: [core],
      memberships: [{ groupId: 'ws_core', personId: 'usr_ada' }],
    })
    const existing = await addReviewer(harness, {
      displayName: 'ada',
      handles: { github: 'Ada' },
      skills: ['payments'],
    })
    await connectCatFactory(harness)
    await sync(harness)
    const [followed] = await reviewers(harness)
    expect(followed).toMatchObject({
      id: existing.id,
      displayName: 'Ada Lovelace',
      handles: { github: 'ada', gitlab: null },
      team: 'Core',
      skills: ['payments'],
      external: { source: 'cat-factory', id: 'usr_ada' },
    })
    const owner = await harness.container.repositories.identities.findReviewerId('github', '583231')
    expect(owner).toBe(existing.id)
  })

  it('adds somebody nobody here matches, with their handle and team', async () => {
    const harness = await syncing({
      persons: [ada()],
      groups: [core],
      memberships: [{ groupId: 'ws_core', personId: 'usr_ada' }],
    })
    await connectCatFactory(harness)
    const connection = await sync(harness)
    expect(await reviewers(harness)).toMatchObject([
      {
        displayName: 'Ada Lovelace',
        handles: { github: 'ada' },
        team: 'Core',
        availability: 'available',
      },
    ])
    expect(connection.repositorySync?.people).toEqual({ listed: 1, linked: 1, withoutAccount: 0 })
  })

  it('refuses edits the directory owns, and keeps the rest editable', async () => {
    const harness = await syncing({ persons: [ada()], groups: [core], memberships: [] })
    await connectCatFactory(harness)
    await sync(harness)
    const [followed] = await reviewers(harness)
    const path = `/api/v1/reviewers/${followed?.id}`
    expect((await harness.app.fetch(patch(path, { displayName: 'Countess' }))).status).toBe(409)
    expect((await harness.app.fetch(patch(path, { team: 'Core' }))).status).toBe(409)
    expect((await harness.app.fetch(patch(path, { skills: ['math'] }))).status).toBe(200)
    const [team] = await teams(harness)
    const rename = await harness.app.fetch(patch(`/api/v1/teams/${team?.id}`, { name: 'Kernel' }))
    expect(rename.status).toBe(409)
  })

  it('pauses somebody the directory stopped listing', async () => {
    const listing: Listing = { persons: [ada()], groups: [core], memberships: [] }
    const harness = await syncing(listing)
    await connectCatFactory(harness)
    await sync(harness)
    listing.persons = [{ ...ada(), id: 'usr_other', accounts: [] }]
    await sync(harness)
    expect((await reviewers(harness)).map((r) => r.availability)).toEqual(['paused'])
  })
})

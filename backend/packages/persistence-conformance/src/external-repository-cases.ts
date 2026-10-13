import assert from 'node:assert/strict'
import type { ExternalRepository } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function listed(source: string, key: string, seq: number, repo = 'payments'): ExternalRepository {
  return {
    source,
    key,
    seq,
    repository: { provider: 'github', owner: 'acme', repo, id: `id-${key}` },
  }
}

function dropped(source: string, key: string, seq: number): ExternalRepository {
  return { source, key, seq, repository: null }
}

function byKey(entries: readonly ExternalRepository[]): ExternalRepository[] {
  return [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export const externalRepositoryCases: readonly ConformanceCase[] = [
  conformanceCase('an external repository round-trips whole', async (repos) => {
    const entry = listed('cat-factory', 'ws_1/101', 7)
    await repos.externalRepositories.apply(entry)
    assert.deepStrictEqual(await repos.externalRepositories.get('cat-factory', 'ws_1/101'), entry)
    assert.strictEqual(await repos.externalRepositories.get('cat-factory', 'ws_1/999'), null)
    assert.strictEqual(await repos.externalRepositories.get('other', 'ws_1/101'), null)
  }),

  conformanceCase('an apply replaces the entry, a dropped state included', async (repos) => {
    await repos.externalRepositories.apply(listed('cat-factory', 'ws_1/101', 7))
    await repos.externalRepositories.apply(dropped('cat-factory', 'ws_1/101', 9))
    assert.deepStrictEqual(await repos.externalRepositories.list('cat-factory'), [
      dropped('cat-factory', 'ws_1/101', 9),
    ])
  }),

  conformanceCase('an apply keeps a newer entry and replaces an equal one', async (repos) => {
    await repos.externalRepositories.apply(dropped('cat-factory', 'ws_1/101', 9))
    await repos.externalRepositories.apply(listed('cat-factory', 'ws_1/101', 7))
    assert.deepStrictEqual(await repos.externalRepositories.list('cat-factory'), [
      dropped('cat-factory', 'ws_1/101', 9),
    ])
    await repos.externalRepositories.apply(listed('cat-factory', 'ws_1/101', 9, 'billing'))
    assert.deepStrictEqual(await repos.externalRepositories.list('cat-factory'), [
      listed('cat-factory', 'ws_1/101', 9, 'billing'),
    ])
  }),

  conformanceCase('external repositories list and clear per source', async (repos) => {
    const mine = [
      listed('cat-factory', 'ws_2/5', 3),
      listed('cat-factory', 'ws_1/101', 7),
      dropped('cat-factory', 'ws_1/7', 2),
    ]
    const theirs = listed('other', 'ws_1/101', 4, 'billing')
    for (const entry of [...mine, theirs]) await repos.externalRepositories.apply(entry)
    assert.deepStrictEqual(byKey(await repos.externalRepositories.list('cat-factory')), byKey(mine))
    await repos.externalRepositories.clear('cat-factory')
    assert.deepStrictEqual(await repos.externalRepositories.list('cat-factory'), [])
    assert.deepStrictEqual(await repos.externalRepositories.list('other'), [theirs])
  }),
]

export const externalRepositoryTenancyCases: readonly TenancyCase[] = [
  tenancyCase('external repositories belong to one org', async (stores) => {
    await stores.forOrg('org-a').externalRepositories.apply(listed('cat-factory', 'ws_1/101', 7))
    await stores
      .forOrg('org-b')
      .externalRepositories.apply(listed('cat-factory', 'ws_1/101', 8, 'billing'))
    await stores.forOrg('org-a').externalRepositories.clear('cat-factory')
    assert.deepStrictEqual(
      await stores.forOrg('org-a').externalRepositories.list('cat-factory'),
      [],
    )
    const held = await stores.forOrg('org-b').externalRepositories.get('cat-factory', 'ws_1/101')
    assert.strictEqual(held?.repository?.repo, 'billing')
  }),
]

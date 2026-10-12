import assert from 'node:assert/strict'
import type { ExternalDirectoryEntry } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { reviewer } from './fixtures.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function person(source: string, key: string, seq: number, name = 'Ada'): ExternalDirectoryEntry {
  return {
    source,
    kind: 'person',
    key,
    seq,
    record: {
      id: key,
      name,
      accounts: [{ provider: 'github', subject: `gh-${key}`, username: name.toLowerCase() }],
    },
  }
}

function group(source: string, key: string, seq: number): ExternalDirectoryEntry {
  return { source, kind: 'group', key, seq, record: { id: key, name: `Group ${key}` } }
}

function dropped(source: string, key: string, seq: number): ExternalDirectoryEntry {
  return { source, kind: 'person', key, seq, record: null }
}

function byKey<T extends { key: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export const externalDirectoryCases: readonly ConformanceCase[] = [
  conformanceCase('an external directory entry round-trips whole, by kind', async (repos) => {
    const ada = person('cat-factory', 'usr_1', 7)
    const team = group('cat-factory', 'ws_1', 3)
    const membership: ExternalDirectoryEntry = {
      source: 'cat-factory',
      kind: 'membership',
      key: 'ws_1/usr_1',
      seq: 4,
      record: { groupId: 'ws_1', personId: 'usr_1' },
    }
    for (const entry of [ada, team, membership]) await repos.externalDirectory.apply(entry)
    assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'person'), [ada])
    assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'group'), [team])
    assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'membership'), [
      membership,
    ])
  }),

  conformanceCase('the same key under two kinds is two entries', async (repos) => {
    await repos.externalDirectory.apply(person('cat-factory', 'x', 7))
    await repos.externalDirectory.apply(group('cat-factory', 'x', 2))
    assert.strictEqual((await repos.externalDirectory.list('cat-factory', 'person')).length, 1)
    assert.strictEqual((await repos.externalDirectory.list('cat-factory', 'group')).length, 1)
  }),

  conformanceCase(
    'a directory apply keeps a newer entry and replaces an equal one',
    async (repos) => {
      await repos.externalDirectory.apply(dropped('cat-factory', 'usr_1', 9))
      await repos.externalDirectory.apply(person('cat-factory', 'usr_1', 7))
      assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'person'), [
        dropped('cat-factory', 'usr_1', 9),
      ])
      await repos.externalDirectory.apply(person('cat-factory', 'usr_1', 9, 'Grace'))
      assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'person'), [
        person('cat-factory', 'usr_1', 9, 'Grace'),
      ])
    },
  ),

  conformanceCase('a reviewer and a team keep the directory entry they follow', async (repos) => {
    const external = { source: 'cat-factory', id: 'usr_1' }
    await repos.reviewers.create(reviewer('r-1', { external }))
    assert.deepStrictEqual((await repos.reviewers.getById('r-1'))?.external, external)
    await repos.reviewers.update('r-1', { external: null })
    assert.strictEqual((await repos.reviewers.getById('r-1'))?.external, null)

    await repos.teams.create({
      id: 't-1',
      name: 'Platform',
      ownerId: null,
      mergeComments: null,
      createdAt: 1,
    })
    await repos.teams.update('t-1', { external: { source: 'cat-factory', id: 'ws_1' } })
    assert.deepStrictEqual((await repos.teams.getById('t-1'))?.external, {
      source: 'cat-factory',
      id: 'ws_1',
    })
  }),

  conformanceCase('external directories list and clear per source', async (repos) => {
    const mine = [person('cat-factory', 'usr_2', 3), dropped('cat-factory', 'usr_1', 2)]
    const theirs = person('other', 'usr_1', 4, 'Grace')
    for (const entry of [...mine, theirs, group('cat-factory', 'ws_1', 1)]) {
      await repos.externalDirectory.apply(entry)
    }
    assert.deepStrictEqual(
      byKey(await repos.externalDirectory.list('cat-factory', 'person')),
      byKey(mine),
    )
    await repos.externalDirectory.clear('cat-factory')
    assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'person'), [])
    assert.deepStrictEqual(await repos.externalDirectory.list('cat-factory', 'group'), [])
    assert.deepStrictEqual(await repos.externalDirectory.list('other', 'person'), [theirs])
  }),
]

export const externalDirectoryTenancyCases: readonly TenancyCase[] = [
  tenancyCase('external directories belong to one org', async (stores) => {
    await stores.forOrg('org-a').externalDirectory.apply(person('cat-factory', 'usr_1', 7))
    await stores.forOrg('org-b').externalDirectory.apply(person('cat-factory', 'usr_1', 8, 'Grace'))
    await stores.forOrg('org-a').externalDirectory.clear('cat-factory')
    assert.deepStrictEqual(
      await stores.forOrg('org-a').externalDirectory.list('cat-factory', 'person'),
      [],
    )
    const [held] = await stores.forOrg('org-b').externalDirectory.list('cat-factory', 'person')
    assert.strictEqual(held?.record?.name, 'Grace')
  }),
]

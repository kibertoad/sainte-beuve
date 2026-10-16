import assert from 'node:assert/strict'
import type { StoredHostSnapshot } from '@sainte-beuve/kernel'
import { type ConformanceCase, conformanceCase } from './case.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function snapshot(key: string, data: unknown, fetchedAt = 1_000): StoredHostSnapshot {
  return { source: 'github', key, data, fetchedAt }
}

export const hostSnapshotCases: readonly ConformanceCase[] = [
  conformanceCase(
    'a host snapshot round-trips its payload and replaces the last',
    async (repos) => {
      const first = snapshot('open-pulls:a/b', [{ number: 1, title: 'One', draft: false }])
      await repos.hostSnapshots.put(first)
      assert.deepStrictEqual(await repos.hostSnapshots.get('github', 'open-pulls:a/b'), first)
      const second = snapshot('open-pulls:a/b', [], 2_000)
      await repos.hostSnapshots.put(second)
      assert.deepStrictEqual(await repos.hostSnapshots.get('github', 'open-pulls:a/b'), second)
    },
  ),

  conformanceCase('a host snapshot is keyed by source as well as key', async (repos) => {
    await repos.hostSnapshots.put(snapshot('open-pulls:a/b', { from: 'github' }))
    assert.strictEqual(await repos.hostSnapshots.get('gitlab', 'open-pulls:a/b'), null)
  }),

  conformanceCase('deleting a host snapshot leaves the others', async (repos) => {
    await repos.hostSnapshots.put(snapshot('open-pulls:a/b', [1]))
    await repos.hostSnapshots.put(snapshot('open-pulls:a/c', [2]))
    await repos.hostSnapshots.delete('github', 'open-pulls:a/b')
    await repos.hostSnapshots.delete('github', 'never-stored')
    assert.strictEqual(await repos.hostSnapshots.get('github', 'open-pulls:a/b'), null)
    assert.deepStrictEqual(
      await repos.hostSnapshots.get('github', 'open-pulls:a/c'),
      snapshot('open-pulls:a/c', [2]),
    )
  }),
]

export const hostSnapshotTenancyCases: readonly TenancyCase[] = [
  tenancyCase('host snapshots belong to one org', async (stores) => {
    await stores.forOrg('org-a').hostSnapshots.put(snapshot('search:x', { from: 'a' }))
    assert.strictEqual(await stores.forOrg('org-b').hostSnapshots.get('github', 'search:x'), null)
  }),
]

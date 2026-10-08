import assert from 'node:assert/strict'
import type { Team } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function team(id: string, name: string, overrides: Partial<Team> = {}): Team {
  return { id, name, ownerId: 'r1', createdAt: 1_000, ...overrides }
}

export const teamCases: readonly ConformanceCase[] = [
  conformanceCase('a team round-trips whole, owner and all', async (repos) => {
    const written = team('t1', 'Platform', { ownerId: null })
    assert.deepStrictEqual(await repos.teams.create(written), written)
    assert.deepStrictEqual(await repos.teams.getById('t1'), written)
    assert.strictEqual(await repos.teams.getById('t-missing'), null)
  }),

  conformanceCase('a team is found by name regardless of case', async (repos) => {
    await repos.teams.create(team('t1', 'Platform'))
    assert.strictEqual((await repos.teams.getByName('platform'))?.id, 't1')
    assert.strictEqual((await repos.teams.getByName(' PLATFORM '))?.id, 't1')
    assert.strictEqual(await repos.teams.getByName('Payments'), null)
  }),

  conformanceCase('teams list by name, case-insensitively', async (repos) => {
    await repos.teams.create(team('t1', 'payments'))
    await repos.teams.create(team('t2', 'Platform'))
    await repos.teams.create(team('t3', 'Billing'))
    const names = (await repos.teams.list()).map((row) => row.name)
    assert.deepStrictEqual(names, ['Billing', 'payments', 'Platform'])
  }),

  conformanceCase('a name in another case is a claim the holder keeps', async (repos) => {
    const held = team('t1', 'Platform')
    await repos.teams.create(held)
    assert.deepStrictEqual(
      await repos.teams.create(team('t2', 'PLATFORM', { ownerId: 'r2' })),
      held,
    )
    assert.strictEqual(await repos.teams.getById('t2'), null)
    assert.strictEqual((await repos.teams.list()).length, 1)
  }),

  conformanceCase('an update renames a team and hands it over', async (repos) => {
    await repos.teams.create(team('t1', 'Platform'))
    const renamed = await repos.teams.update('t1', { name: 'Core' })
    assert.deepStrictEqual(renamed, team('t1', 'Core'))
    const handed = await repos.teams.update('t1', { ownerId: 'r2' })
    assert.deepStrictEqual(handed, team('t1', 'Core', { ownerId: 'r2' }))
    assert.deepStrictEqual(await repos.teams.getById('t1'), handed)
    // The old name is free again, and the new one is the team's.
    assert.strictEqual(await repos.teams.getByName('Platform'), null)
    assert.strictEqual((await repos.teams.getByName('core'))?.id, 't1')
  }),

  conformanceCase('updating a team that is gone answers null', async (repos) => {
    assert.strictEqual(await repos.teams.update('t-missing', { name: 'Core' }), null)
  }),

  conformanceCase('deleting a team leaves the others', async (repos) => {
    await repos.teams.create(team('t1', 'Platform'))
    await repos.teams.create(team('t2', 'Payments'))
    await repos.teams.delete('t1')
    assert.strictEqual(await repos.teams.getById('t1'), null)
    assert.deepStrictEqual(
      (await repos.teams.list()).map((row) => row.id),
      ['t2'],
    )
  }),
]

export const teamTenancyCases: readonly TenancyCase[] = [
  tenancyCase('a team name belongs to one org', async (stores) => {
    await stores.forOrg('org-a').teams.create(team('ta', 'Platform'))
    // The same name in another org is another team, not a lost claim.
    const other = await stores.forOrg('org-b').teams.create(team('tb', 'Platform'))
    assert.strictEqual(other.id, 'tb')
    await stores.forOrg('org-a').teams.delete('ta')
    assert.strictEqual(await stores.forOrg('org-a').teams.getByName('Platform'), null)
    assert.strictEqual((await stores.forOrg('org-b').teams.getByName('Platform'))?.id, 'tb')
  }),
]

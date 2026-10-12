import type { Team } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { planDirectoryTeams } from './directoryTeams.js'

const SOURCE = 'cat-factory'

function team(id: string, name: string, groupId: string | null = null): Team {
  return {
    id,
    name,
    ownerId: null,
    mergeComments: null,
    external: groupId === null ? null : { source: SOURCE, id: groupId },
    createdAt: 1,
  }
}

describe('planDirectoryTeams', () => {
  it('creates a team per new group, and records the name each group lands under', () => {
    const plan = planDirectoryTeams(SOURCE, [], [{ id: 'ws_1', name: 'Core' }])
    expect(plan.create).toEqual([{ name: 'Core', external: { source: SOURCE, id: 'ws_1' } }])
    expect(plan.nameByGroup.get('ws_1')).toBe('Core')
  })

  it("adopts an admin's team holding the group's name, in the group's spelling", () => {
    const plan = planDirectoryTeams(SOURCE, [team('t1', 'core')], [{ id: 'ws_1', name: 'Core' }])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([
      {
        teamId: 't1',
        previousName: 'core',
        name: 'Core',
        external: { source: SOURCE, id: 'ws_1' },
      },
    ])
  })

  it('renames a followed team with its group, and leaves an unchanged one alone', () => {
    const teams = [team('t1', 'Core', 'ws_1'), team('t2', 'Web', 'ws_2')]
    const groups = [
      { id: 'ws_1', name: 'Platform' },
      { id: 'ws_2', name: 'Web' },
    ]
    const plan = planDirectoryTeams(SOURCE, teams, groups)
    expect(plan.update).toEqual([
      {
        teamId: 't1',
        previousName: 'Core',
        name: 'Platform',
        external: { source: SOURCE, id: 'ws_1' },
      },
    ])
  })

  it('removes a followed team whose group is gone, and never one it does not follow', () => {
    const teams = [team('t1', 'Core', 'ws_1'), team('t2', 'Local'), team('t3', 'Elsewhere')]
    teams[2] = { ...teams[2]!, external: { source: 'other', id: 'ws_1' } }
    const plan = planDirectoryTeams(SOURCE, teams, [])
    expect(plan.remove).toEqual([{ teamId: 't1', name: 'Core' }])
  })

  it('suffixes a name another team or an earlier group already holds', () => {
    const teams = [team('t1', 'Core', 'ws_9')]
    const groups = [
      { id: 'ws_1', name: 'Core' },
      { id: 'ws_2', name: 'core' },
      { id: 'ws_9', name: 'Core Infra' },
    ]
    const plan = planDirectoryTeams(SOURCE, teams, groups)
    expect(plan.create.map((step) => step.name)).toEqual(['Core (ws_1)', 'core (ws_2)'])
    expect(plan.nameByGroup.get('ws_9')).toBe('Core Infra')
  })
})

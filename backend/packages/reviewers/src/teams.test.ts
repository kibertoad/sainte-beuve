import type { Team } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { decideTeamAction, ownerOfNewTeam, type TeamActor } from './teams.js'

const ada: TeamActor = { reviewerId: 'r-ada', admin: false }
const admin: TeamActor = { reviewerId: 'r-admin', admin: true }
const machine: TeamActor = { reviewerId: null, admin: false }

function team(ownerId: string | null): Team {
  return { id: 't1', name: 'Platform', ownerId, mergeComments: null, createdAt: 1 }
}

describe('decideTeamAction', () => {
  it('lets anybody create a team they own, and only an admin create one for somebody else', () => {
    expect(decideTeamAction(ada, { kind: 'create', ownerId: 'r-ada' }).allowed).toBe(true)
    expect(decideTeamAction(ada, { kind: 'create', ownerId: 'r-bob' }).allowed).toBe(false)
    expect(decideTeamAction(ada, { kind: 'create', ownerId: null }).allowed).toBe(false)
    expect(decideTeamAction(admin, { kind: 'create', ownerId: 'r-bob' }).allowed).toBe(true)
  })

  it("lets the owner change their team, and nobody else's but an admin", () => {
    expect(decideTeamAction(ada, { kind: 'change', team: team('r-ada') }).allowed).toBe(true)
    expect(decideTeamAction(ada, { kind: 'change', team: team('r-bob') }).allowed).toBe(false)
    expect(decideTeamAction(ada, { kind: 'change', team: team(null) }).allowed).toBe(false)
    expect(decideTeamAction(admin, { kind: 'change', team: team('r-bob') }).allowed).toBe(true)
  })

  it('lets an owner hand their team to somebody else', () => {
    const handover = { kind: 'change' as const, team: team('r-ada'), newOwnerId: 'r-bob' }
    expect(decideTeamAction(ada, handover).allowed).toBe(true)
  })

  it('refuses a caller that is not a person, unless it is an admin', () => {
    expect(decideTeamAction(machine, { kind: 'create', ownerId: null }).allowed).toBe(false)
    expect(
      decideTeamAction({ reviewerId: null, admin: true }, { kind: 'create', ownerId: null }),
    ).toStrictEqual({ allowed: true })
  })
})

describe('ownerOfNewTeam', () => {
  it('makes the creator the owner unless the request names one', () => {
    expect(ownerOfNewTeam(ada, undefined)).toBe('r-ada')
    expect(ownerOfNewTeam(admin, 'r-bob')).toBe('r-bob')
    expect(ownerOfNewTeam(admin, null)).toBeNull()
  })
})

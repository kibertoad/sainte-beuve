import type { ExternalPerson, Reviewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  accountKey,
  type DirectoryPeopleInput,
  handleMatchCandidates,
  planDirectoryPeople,
} from './directoryPeople.js'

const SOURCE = 'cat-factory'

function reviewer(id: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id,
    displayName: id,
    handles: { github: null, gitlab: null },
    slackUserId: null,
    team: null,
    skills: [],
    domains: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    external: null,
    createdAt: 1,
    ...overrides,
  }
}

function person(id: string, overrides: Partial<ExternalPerson> = {}): ExternalPerson {
  return {
    id,
    name: `Person ${id}`,
    accounts: [{ provider: 'github', subject: `gh-${id}`, username: `${id}-gh` }],
    ...overrides,
  }
}

function input(overrides: Partial<DirectoryPeopleInput>): DirectoryPeopleInput {
  return {
    source: SOURCE,
    reviewers: [],
    persons: [],
    everListed: true,
    memberships: [],
    teamNameByGroup: new Map(),
    accountOwners: new Map(),
    linkedHosts: new Map(),
    ...overrides,
  }
}

const followed = (id: string) => ({ external: { source: SOURCE, id } })

describe('planDirectoryPeople', () => {
  it('follows the reviewer a host account is already linked to', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [reviewer('r1', { displayName: 'Old name' })],
        persons: [person('u1')],
        accountOwners: new Map([[accountKey({ provider: 'github', subject: 'gh-u1' }), 'r1']]),
      }),
    )
    expect(plan.update).toEqual([
      {
        reviewerId: 'r1',
        patch: {
          external: { source: SOURCE, id: 'u1' },
          displayName: 'Person u1',
          handles: { github: 'u1-gh', gitlab: null },
        },
      },
    ])
    expect(plan.link).toEqual([])
    expect(plan.create).toEqual([])
  })

  it('falls back to the handle on that host, and links the account to the reviewer', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [reviewer('r1', { handles: { github: 'U1-GH', gitlab: null } })],
        persons: [person('u1')],
      }),
    )
    expect(plan.update[0]?.reviewerId).toBe('r1')
    expect(plan.link).toEqual([
      { reviewerId: 'r1', account: { provider: 'github', subject: 'gh-u1', username: 'u1-gh' } },
    ])
  })

  it('never takes a reviewer that follows somebody else', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [
          reviewer('r1', { handles: { github: 'u1-gh', gitlab: null }, ...followed('u9') }),
        ],
        persons: [person('u1'), person('u9')],
      }),
    )
    expect(plan.create.map((step) => step.external.id)).toEqual(['u1'])
  })

  it('never matches by handle a reviewer with another account linked on that host', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [reviewer('r1', { handles: { github: 'u1-gh', gitlab: null } })],
        persons: [person('u1')],
        linkedHosts: new Map([['r1', new Set(['github' as const])]]),
      }),
    )
    expect(plan.update).toEqual([])
    expect(plan.create.map((step) => step.external.id)).toEqual(['u1'])
  })

  it('names as handle candidates only unfollowed reviewers holding a listed username', () => {
    const reviewers = [
      reviewer('r1', { handles: { github: 'U1-GH', gitlab: null } }),
      reviewer('r2', { handles: { github: 'u1-gh', gitlab: null }, ...followed('u1') }),
      reviewer('r3', { handles: { github: null, gitlab: 'u1-gh' } }),
    ]
    const candidates = handleMatchCandidates(SOURCE, reviewers, [person('u1')])
    expect(candidates.map((r) => r.id)).toEqual(['r1'])
  })

  it('creates a reviewer for somebody unmatched with a host account', () => {
    const plan = planDirectoryPeople(
      input({
        persons: [person('u1', { name: null })],
        memberships: [{ groupId: 'ws_1', personId: 'u1' }],
        teamNameByGroup: new Map([['ws_1', 'Core']]),
      }),
    )
    expect(plan.create).toEqual([
      {
        displayName: 'u1-gh',
        handles: { github: 'u1-gh', gitlab: null },
        team: 'Core',
        availability: 'paused',
        external: { source: SOURCE, id: 'u1' },
        accounts: person('u1').accounts,
      },
    ])
    expect(plan.summary).toEqual({ listed: 1, linked: 1, withoutAccount: 0, awaitingSetup: 1 })
  })

  it('counts somebody with no host account rather than guessing who they are', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [reviewer('r1', { displayName: 'Person u1' })],
        persons: [person('u1', { accounts: [] })],
      }),
    )
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([])
    expect(plan.summary).toEqual({ listed: 1, linked: 0, withoutAccount: 1, awaitingSetup: 0 })
  })

  it('counts followed reviewers still paused with no skills as awaiting setup', () => {
    const owned = (id: string) => [accountKey({ provider: 'github', subject: `gh-${id}` }), id]
    const plan = planDirectoryPeople(
      input({
        reviewers: [
          reviewer('u1', { ...followed('u1'), availability: 'paused' }),
          reviewer('u2', { ...followed('u2'), availability: 'paused', skills: ['go'] }),
          reviewer('u3', followed('u3')),
        ],
        persons: [person('u1'), person('u2'), person('u3')],
        accountOwners: new Map([owned('u1'), owned('u2'), owned('u3')] as [string, string][]),
      }),
    )
    expect(plan.summary.awaitingSetup).toBe(1)
  })

  it("keeps a person's team while it is still one of theirs, else takes the first by name", () => {
    const memberships = [
      { groupId: 'ws_1', personId: 'u1' },
      { groupId: 'ws_2', personId: 'u1' },
    ]
    const teamNameByGroup = new Map([
      ['ws_1', 'Web'],
      ['ws_2', 'Core'],
    ])
    const plan = (team: string) =>
      planDirectoryPeople(
        input({
          reviewers: [
            reviewer('r1', {
              ...followed('u1'),
              displayName: 'Person u1',
              handles: { github: 'u1-gh', gitlab: null },
              team,
            }),
          ],
          persons: [person('u1')],
          memberships,
          teamNameByGroup,
          accountOwners: new Map([['github:gh-u1', 'r1']]),
        }),
      )
    expect(plan('web').update).toEqual([{ reviewerId: 'r1', patch: { team: 'Web' } }])
    expect(plan('Gone').update).toEqual([{ reviewerId: 'r1', patch: { team: 'Core' } }])
  })

  it('pauses a followed reviewer the source stopped listing, once it has listed anybody', () => {
    const reviewers = [
      reviewer('r1', followed('u1')),
      reviewer('r2', { ...followed('u2'), availability: 'paused' }),
      reviewer('r3'),
    ]
    expect(planDirectoryPeople(input({ reviewers })).pause).toEqual(['r1'])
    expect(planDirectoryPeople(input({ reviewers, everListed: false })).pause).toEqual([])
  })

  it('moves a re-created user onto the row their host account is linked to, without pausing it', () => {
    const plan = planDirectoryPeople(
      input({
        reviewers: [reviewer('r1', followed('u-old'))],
        persons: [person('u-new')],
        accountOwners: new Map([[accountKey({ provider: 'github', subject: 'gh-u-new' }), 'r1']]),
      }),
    )
    expect(plan.create).toEqual([])
    expect(plan.update[0]?.patch.external).toEqual({ source: SOURCE, id: 'u-new' })
    expect(plan.pause).toEqual([])
  })

  it('names a reviewer within the bounds the store keeps, never blank', () => {
    const plan = planDirectoryPeople(
      input({
        persons: [person('u1', { name: '   ' }), person('u2', { name: 'n'.repeat(200) })],
      }),
    )
    expect(plan.create.map((step) => step.displayName)).toEqual(['u1-gh', 'n'.repeat(120)])
  })
})

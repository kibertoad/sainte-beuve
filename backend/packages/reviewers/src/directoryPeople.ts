import type {
  ExternalAccount,
  ExternalMembership,
  ExternalPerson,
  ExternalRef,
  PeopleSync,
  Reviewer,
  VcsHandles,
} from '@sainte-beuve/contracts'
import { isSameHandle } from './selection.js'

/**
 * Which reviewers an external directory's people are, and what of them it owns.
 *
 * A person is matched, in order, to the reviewer already following them, to the
 * reviewer one of their host accounts is linked to here, or to the reviewer
 * whose handle on that host is the account's username. Somebody unmatched with a
 * host account becomes a new reviewer; somebody with none cannot be told apart
 * from a stranger and is only counted. A followed reviewer the directory no
 * longer lists is paused, never deleted: assignments and sessions point at the row.
 *
 * The directory owns a followed reviewer's name, handles and team. Skills,
 * domains, weight, availability, Slack and role stay this org's.
 */
export interface DirectoryPeopleInput {
  source: string
  reviewers: readonly Reviewer[]
  /** The people the source lists now. */
  persons: readonly ExternalPerson[]
  /** Whether the source has ever listed anybody. Until it has, nobody is paused. */
  everListed: boolean
  memberships: readonly ExternalMembership[]
  /** The team each group lands under, from `planDirectoryTeams`. */
  teamNameByGroup: ReadonlyMap<string, string>
  /** The reviewer each host account is linked to here, keyed by `accountKey`. */
  accountOwners: ReadonlyMap<string, string>
}

export type DirectoryOwnedFields = Partial<
  Pick<Reviewer, 'displayName' | 'handles' | 'team' | 'external'>
>

export interface DirectoryPeoplePlan {
  update: { reviewerId: string; patch: DirectoryOwnedFields }[]
  create: {
    displayName: string
    handles: VcsHandles
    team: string | null
    external: ExternalRef
    accounts: ExternalAccount[]
  }[]
  /** Host accounts to link to a reviewer that already exists. */
  link: { reviewerId: string; account: ExternalAccount }[]
  pause: string[]
  summary: PeopleSync
}

export function accountKey(account: Pick<ExternalAccount, 'provider' | 'subject'>): string {
  return `${account.provider}:${account.subject}`
}

export function planDirectoryPeople(input: DirectoryPeopleInput): DirectoryPeoplePlan {
  const plan: DirectoryPeoplePlan = {
    update: [],
    create: [],
    link: [],
    pause: [],
    summary: { listed: input.persons.length, linked: 0, withoutAccount: 0 },
  }
  const claimed = new Set<string>()
  for (const person of input.persons) {
    const reviewer = matchReviewer(person, input, claimed)
    if (reviewer === null && person.accounts.length === 0) {
      plan.summary.withoutAccount += 1
      continue
    }
    plan.summary.linked += 1
    const external = { source: input.source, id: person.id }
    const team = teamFor(person.id, reviewer?.team ?? null, input)
    if (reviewer === null) {
      plan.create.push({ ...newcomer(person), team, external, accounts: person.accounts })
      continue
    }
    claimed.add(reviewer.id)
    const patch = patchFor(reviewer, person, team, external)
    if (Object.keys(patch).length > 0) plan.update.push({ reviewerId: reviewer.id, patch })
    for (const account of person.accounts) {
      if (input.accountOwners.get(accountKey(account)) !== reviewer.id) {
        plan.link.push({ reviewerId: reviewer.id, account })
      }
    }
  }
  if (input.everListed) plan.pause = departed(input)
  return plan
}

function followedBy(reviewer: Reviewer, source: string): string | null {
  return reviewer.external?.source === source ? reviewer.external.id : null
}

function matchReviewer(
  person: ExternalPerson,
  input: DirectoryPeopleInput,
  claimed: ReadonlySet<string>,
): Reviewer | null {
  const free = (reviewer: Reviewer): boolean => {
    if (claimed.has(reviewer.id)) return false
    const follows = followedBy(reviewer, input.source)
    return follows === null || follows === person.id
  }
  const following = input.reviewers.find((r) => followedBy(r, input.source) === person.id)
  if (following !== undefined && !claimed.has(following.id)) return following
  for (const account of person.accounts) {
    const ownerId = input.accountOwners.get(accountKey(account))
    const owner = input.reviewers.find((r) => r.id === ownerId)
    if (owner !== undefined && free(owner)) return owner
  }
  for (const account of person.accounts) {
    if (account.username === null) continue
    const named = input.reviewers.find(
      (r) => free(r) && isSameHandle(r.handles[account.provider], account.username),
    )
    if (named !== undefined) return named
  }
  return null
}

/**
 * The team a person lands in: the one they are in now when it is still one of
 * their groups', so a person in two workspaces is not moved on every sync, or
 * else the first of their groups' teams by name.
 */
function teamFor(
  personId: string,
  current: string | null,
  input: DirectoryPeopleInput,
): string | null {
  const names = input.memberships
    .filter((membership) => membership.personId === personId)
    .flatMap((membership) => input.teamNameByGroup.get(membership.groupId) ?? [])
    .sort((a, b) => a.localeCompare(b))
  const currentKey = current?.trim().toLowerCase()
  const kept = names.find((name) => name.trim().toLowerCase() === currentKey)
  return kept ?? names[0] ?? null
}

/** A person's handles on each host they have an account on, over the ones already held. */
function handlesWith(current: VcsHandles, accounts: readonly ExternalAccount[]): VcsHandles {
  const next = { ...current }
  for (const account of accounts) {
    if (account.username !== null) next[account.provider] = account.username
  }
  return next
}

function newcomer(person: ExternalPerson): { displayName: string; handles: VcsHandles } {
  const handles = handlesWith({ github: null, gitlab: null }, person.accounts)
  const username = person.accounts.find((account) => account.username !== null)?.username
  return { displayName: person.name ?? username ?? person.id, handles }
}

function patchFor(
  reviewer: Reviewer,
  person: ExternalPerson,
  team: string | null,
  external: ExternalRef,
): DirectoryOwnedFields {
  const patch: DirectoryOwnedFields = {}
  if (followedBy(reviewer, external.source) !== external.id) patch.external = external
  if (person.name !== null && person.name !== reviewer.displayName) patch.displayName = person.name
  const handles = handlesWith(reviewer.handles, person.accounts)
  if (handles.github !== reviewer.handles.github || handles.gitlab !== reviewer.handles.gitlab) {
    patch.handles = handles
  }
  if (team !== reviewer.team) patch.team = team
  return patch
}

/** Available reviewers following somebody the source no longer lists. */
function departed(input: DirectoryPeopleInput): string[] {
  const listed = new Set(input.persons.map((person) => person.id))
  return input.reviewers
    .filter((reviewer) => {
      const follows = followedBy(reviewer, input.source)
      return follows !== null && !listed.has(follows) && reviewer.availability === 'available'
    })
    .map((reviewer) => reviewer.id)
}

import {
  type ExternalAccount,
  type ExternalMembership,
  type ExternalPerson,
  type ExternalRef,
  type IdentityProvider,
  type PeopleSync,
  REVIEWER_NAME_MAX_LENGTH,
  type Reviewer,
  type VcsHandles,
} from '@sainte-beuve/contracts'
import { isSameHandle } from './selection.js'

/**
 * Which reviewers an external directory's people are, and what of them it owns.
 *
 * A person is matched, in order, to the reviewer already following them, to the
 * reviewer one of their host accounts is linked to here (even one following a
 * person the source no longer lists, which is how a re-created user keeps their
 * row), or to the reviewer whose handle on that host is the account's username
 * and who has no other account linked on that host. Somebody unmatched with a
 * host account becomes a new reviewer; somebody with none cannot be told apart
 * from a stranger and is only counted. A followed reviewer the directory no
 * longer lists is paused, never deleted: assignments and sessions point at the row.
 *
 * A new reviewer joins paused. They have no skills yet, and a source can list
 * hundreds of people at once: drawn straight away, they would take reviews
 * nobody chose them for. An admin gives them skills and resumes them.
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
  /**
   * The hosts each reviewer already has an account linked on, by reviewer id.
   * Needed for every reviewer a handle could match; a missing entry is none.
   */
  linkedHosts: ReadonlyMap<string, ReadonlySet<IdentityProvider>>
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
    availability: 'paused'
    external: ExternalRef
    /** Never empty: somebody with no host account cannot be told apart from a stranger. */
    accounts: [ExternalAccount, ...ExternalAccount[]]
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
    summary: { listed: input.persons.length, linked: 0, withoutAccount: 0, awaitingSetup: 0 },
  }
  const state = { claimed: new Set<string>(), listed: new Set(input.persons.map((p) => p.id)) }
  for (const person of input.persons) {
    const reviewer = matchReviewer(person, input, state)
    if (reviewer === null) planNewcomer(plan, person, input)
    else planFollowed(plan, reviewer, person, input)
    if (reviewer !== null) state.claimed.add(reviewer.id)
  }
  if (input.everListed) plan.pause = departed(input, state)
  return plan
}

/** A person nobody here matches: a new reviewer, or only counted when they have no host account. */
function planNewcomer(
  plan: DirectoryPeoplePlan,
  person: ExternalPerson,
  input: DirectoryPeopleInput,
): void {
  const [account, ...others] = person.accounts
  if (account === undefined) {
    plan.summary.withoutAccount += 1
    return
  }
  plan.summary.linked += 1
  plan.summary.awaitingSetup += 1
  plan.create.push({
    ...newcomer(person),
    team: teamFor(person.id, null, input),
    availability: 'paused',
    external: { source: input.source, id: person.id },
    accounts: [account, ...others],
  })
}

function planFollowed(
  plan: DirectoryPeoplePlan,
  reviewer: Reviewer,
  person: ExternalPerson,
  input: DirectoryPeopleInput,
): void {
  plan.summary.linked += 1
  if (awaitsSetup(reviewer)) plan.summary.awaitingSetup += 1
  const external = { source: input.source, id: person.id }
  const patch = patchFor(reviewer, person, teamFor(person.id, reviewer.team, input), external)
  if (Object.keys(patch).length > 0) plan.update.push({ reviewerId: reviewer.id, patch })
  for (const account of person.accounts) {
    if (input.accountOwners.get(accountKey(account)) !== reviewer.id) {
      plan.link.push({ reviewerId: reviewer.id, account })
    }
  }
}

/** The reviewers matched so far in this plan, and the people the source lists now. */
interface MatchState {
  claimed: ReadonlySet<string>
  listed: ReadonlySet<string>
}

function followedBy(reviewer: Reviewer, source: string): string | null {
  return reviewer.external?.source === source ? reviewer.external.id : null
}

function matchReviewer(
  person: ExternalPerson,
  input: DirectoryPeopleInput,
  { claimed, listed }: MatchState,
): Reviewer | null {
  const free = (reviewer: Reviewer, orphanToo: boolean): boolean => {
    if (claimed.has(reviewer.id)) return false
    const follows = followedBy(reviewer, input.source)
    return follows === null || follows === person.id || (orphanToo && !listed.has(follows))
  }
  const following = input.reviewers.find((r) => followedBy(r, input.source) === person.id)
  if (following !== undefined && !claimed.has(following.id)) return following
  for (const account of person.accounts) {
    const ownerId = input.accountOwners.get(accountKey(account))
    const owner = input.reviewers.find((r) => r.id === ownerId)
    if (owner !== undefined && free(owner, true)) return owner
  }
  for (const account of person.accounts) {
    if (account.username === null) continue
    const named = input.reviewers.find(
      (r) =>
        free(r, false) &&
        isSameHandle(r.handles[account.provider], account.username) &&
        !input.linkedHosts.get(r.id)?.has(account.provider),
    )
    if (named !== undefined) return named
  }
  return null
}

/**
 * The reviewers a listed account could match by handle alone: followed by
 * nobody from this source, holding that username on that host. The caller reads
 * which hosts they have accounts linked on (`linkedHosts`) for these only.
 */
export function handleMatchCandidates(
  source: string,
  reviewers: readonly Reviewer[],
  persons: readonly ExternalPerson[],
): Reviewer[] {
  const accounts = persons.flatMap((person) => person.accounts)
  return reviewers.filter(
    (reviewer) =>
      followedBy(reviewer, source) === null &&
      accounts.some((account) =>
        isSameHandle(reviewer.handles[account.provider], account.username),
      ),
  )
}

/**
 * Whether a reviewer the directory follows still waits for an admin: paused,
 * with no skills to be matched on. A new reviewer starts this way.
 */
function awaitsSetup(reviewer: Reviewer): boolean {
  return reviewer.availability === 'paused' && reviewer.skills.length === 0
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
  const username = person.accounts.find((account) => account.username !== null)?.username ?? null
  const displayName =
    displayNameOf(person.name) ?? displayNameOf(username) ?? displayNameOf(person.id) ?? person.id
  return { displayName, handles }
}

/** A name the reviewer store accepts, or null for a blank one: an invalid name fails every read. */
function displayNameOf(name: string | null): string | null {
  const trimmed = name?.trim() ?? ''
  if (trimmed.length === 0) return null
  return trimmed.slice(0, REVIEWER_NAME_MAX_LENGTH).trimEnd()
}

function patchFor(
  reviewer: Reviewer,
  person: ExternalPerson,
  team: string | null,
  external: ExternalRef,
): DirectoryOwnedFields {
  const patch: DirectoryOwnedFields = {}
  if (followedBy(reviewer, external.source) !== external.id) patch.external = external
  const name = displayNameOf(person.name)
  if (name !== null && name !== reviewer.displayName) patch.displayName = name
  const handles = handlesWith(reviewer.handles, person.accounts)
  if (handles.github !== reviewer.handles.github || handles.gitlab !== reviewer.handles.gitlab) {
    patch.handles = handles
  }
  if (team !== reviewer.team) patch.team = team
  return patch
}

/** Available reviewers following somebody the source no longer lists, and matched to nobody now. */
function departed(input: DirectoryPeopleInput, { claimed, listed }: MatchState): string[] {
  return input.reviewers
    .filter((reviewer) => {
      const follows = followedBy(reviewer, input.source)
      if (follows === null || listed.has(follows) || claimed.has(reviewer.id)) return false
      return reviewer.availability === 'available'
    })
    .map((reviewer) => reviewer.id)
}

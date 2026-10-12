import type {
  ExternalPerson,
  ExternalRef,
  IdentityProvider,
  PeopleSync,
  Reviewer,
} from '@sainte-beuve/contracts'
import {
  accountKey,
  type DirectoryPeoplePlan,
  type DirectoryTeamPlan,
  handleMatchCandidates,
  planDirectoryPeople,
  planDirectoryTeams,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { SessionService } from '../auth/SessionService.js'
import { renameTeamOnReviewers } from '../teams/TeamService.js'

/**
 * Bring the org's teams and reviewers to what one source's directory mirror
 * lists now. The decisions are `planDirectoryTeams` and `planDirectoryPeople`;
 * this writes them, teams first, because a reviewer's team is named after one.
 * Answers how many rows changed and the people summary the screen shows.
 */
export async function syncDirectoryPeople(
  container: AppContainer,
  source: string,
): Promise<{ changed: number; people: PeopleSync }> {
  const { externalDirectory, teams } = container.repositories
  const [personEntries, groupEntries, membershipEntries] = await Promise.all([
    externalDirectory.list(source, 'person'),
    externalDirectory.list(source, 'group'),
    externalDirectory.list(source, 'membership'),
  ])
  const groups = groupEntries.flatMap((entry) => entry.record ?? [])
  const teamPlan = planDirectoryTeams(source, await teams.list(), groups)
  // A source that never listed a group is far more often a key that reaches no
  // workspace than an org whose workspaces are all gone, so it removes nothing.
  if (groupEntries.length === 0) teamPlan.remove = []
  let changed = await applyTeamPlan(container, teamPlan)

  const persons = personEntries.flatMap((entry) => entry.record ?? [])
  const reviewers = await container.repositories.reviewers.list()
  const [owners, hosts] = await Promise.all([
    accountOwners(container, persons),
    linkedHosts(container, handleMatchCandidates(source, reviewers, persons)),
  ])
  const peoplePlan = planDirectoryPeople({
    source,
    reviewers,
    persons,
    everListed: personEntries.length > 0,
    memberships: membershipEntries.flatMap((entry) => entry.record ?? []),
    teamNameByGroup: teamPlan.nameByGroup,
    accountOwners: owners,
    linkedHosts: hosts,
  })
  changed += await applyPeoplePlan(container, peoplePlan)
  return { changed, people: peoplePlan.summary }
}

async function applyTeamPlan(container: AppContainer, plan: DirectoryTeamPlan): Promise<number> {
  const { teams } = container.repositories
  for (const { teamId, name } of plan.remove) {
    await teams.delete(teamId)
    await renameTeamOnReviewers(container, name, null)
  }
  for (const { teamId, previousName, name, external } of plan.update) {
    await teams.update(teamId, { name, external })
    if (previousName !== name) await renameTeamOnReviewers(container, previousName, name)
  }
  for (const { name, external } of plan.create) {
    await teams.create({
      id: container.ids.next(),
      name,
      ownerId: null,
      mergeComments: null,
      external,
      createdAt: container.clock.now(),
    })
  }
  return plan.remove.length + plan.update.length + plan.create.length
}

async function applyPeoplePlan(container: AppContainer, plan: DirectoryPeoplePlan) {
  const { reviewers, identities } = container.repositories
  const now = container.clock.now()
  for (const { reviewerId, patch } of plan.update) await reviewers.update(reviewerId, patch)
  let created = 0
  for (const newcomer of plan.create) if (await createNewcomer(container, newcomer)) created += 1
  for (const { reviewerId, account } of plan.link) {
    await identities.link(reviewerId, linked(account, now))
  }
  const sessions = new SessionService(container)
  for (const reviewerId of plan.pause) {
    await reviewers.update(reviewerId, { availability: 'paused' })
    // Leaving the directory is leaving the org, so it ends their sessions as a pause by an admin does.
    await sessions.revokeForReviewer(reviewerId)
  }
  return plan.update.length + created + plan.pause.length
}

/**
 * Write one new reviewer, claiming their first host account BEFORE the row, as
 * a sign-in does: two settles running at once (a push and the clock) both plan
 * the same newcomer, and the claim is what decides which one writes them. A
 * claim whose row never got written (a settle that died between the two) is
 * finished under the claimed id. Answers whether this call wrote the row.
 */
async function createNewcomer(
  container: AppContainer,
  { accounts: [first, ...others], ...fields }: DirectoryPeoplePlan['create'][number],
): Promise<boolean> {
  const { reviewers, identities } = container.repositories
  const now = container.clock.now()
  const candidateId = container.ids.next()
  const reviewerId = await identities.link(candidateId, linked(first, now))
  if (reviewerId !== candidateId && (await reviewers.getById(reviewerId)) !== null) return false
  await reviewers.create({
    ...fields,
    id: reviewerId,
    slackUserId: null,
    skills: [],
    domains: [],
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: now,
  })
  for (const account of others) await identities.link(reviewerId, linked(account, now))
  return true
}

/**
 * Let go of every team and reviewer one source follows, when the org stops
 * following it. The rows stay, now the admins' to edit; a later connection,
 * possibly to another instance, matches them afresh instead of reading a
 * workspace or a person it never listed as one that went away.
 */
export async function detachDirectory(container: AppContainer, source: string): Promise<void> {
  const { teams, reviewers } = container.repositories
  for (const team of await teams.list()) {
    if (team.external?.source === source) await teams.update(team.id, { external: null })
  }
  for (const reviewer of await reviewers.list()) {
    if (reviewer.external?.source === source)
      await reviewers.update(reviewer.id, { external: null })
  }
}

function linked(account: ExternalPerson['accounts'][number], now: number) {
  return {
    provider: account.provider,
    subject: account.subject,
    username: account.username,
    linkedAt: now,
  }
}

/** The reviewer each listed host account is linked to here. */
async function accountOwners(
  container: AppContainer,
  persons: readonly ExternalPerson[],
): Promise<Map<string, string>> {
  const { identities } = container.repositories
  const accounts = persons.flatMap((person) => person.accounts)
  const owners = await Promise.all(
    accounts.map((account) => identities.findReviewerId(account.provider, account.subject)),
  )
  return new Map(
    accounts.flatMap((account, at) => {
      const owner = owners[at]
      return owner === null || owner === undefined ? [] : [[accountKey(account), owner] as const]
    }),
  )
}

/** The hosts each of these reviewers has an account linked on. */
async function linkedHosts(
  container: AppContainer,
  candidates: readonly Reviewer[],
): Promise<Map<string, Set<IdentityProvider>>> {
  const { identities } = container.repositories
  const linkedPerReviewer = await Promise.all(
    candidates.map((reviewer) => identities.listForReviewer(reviewer.id)),
  )
  return new Map(
    candidates.map((reviewer, at) => [
      reviewer.id,
      new Set((linkedPerReviewer[at] ?? []).map((identity) => identity.provider)),
    ]),
  )
}

/** The teams a followed person's groups put them in, by name. */
export async function directoryTeamNames(
  container: AppContainer,
  person: ExternalRef,
): Promise<string[]> {
  const { externalDirectory, teams } = container.repositories
  const memberships = await externalDirectory.list(person.source, 'membership')
  const groupIds = new Set(
    memberships.flatMap((entry) =>
      entry.record?.personId === person.id ? [entry.record.groupId] : [],
    ),
  )
  return (await teams.list())
    .filter((team) => team.external?.source === person.source && groupIds.has(team.external.id))
    .map((team) => team.name)
}

import type { ExternalPerson, ExternalRef, PeopleSync } from '@sainte-beuve/contracts'
import {
  accountKey,
  type DirectoryPeoplePlan,
  type DirectoryTeamPlan,
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
  const peoplePlan = planDirectoryPeople({
    source,
    reviewers: await container.repositories.reviewers.list(),
    persons,
    everListed: personEntries.length > 0,
    memberships: membershipEntries.flatMap((entry) => entry.record ?? []),
    teamNameByGroup: teamPlan.nameByGroup,
    accountOwners: await accountOwners(container, persons),
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
  for (const { accounts, ...fields } of plan.create) {
    const created = await reviewers.create({
      ...fields,
      id: container.ids.next(),
      slackUserId: null,
      skills: [],
      domains: [],
      availability: 'available',
      role: 'member',
      weight: 1,
      outstandingReviews: 0,
      createdAt: now,
    })
    for (const account of accounts) await identities.link(created.id, linked(account, now))
  }
  for (const { reviewerId, account } of plan.link) {
    await identities.link(reviewerId, linked(account, now))
  }
  const sessions = new SessionService(container)
  for (const reviewerId of plan.pause) {
    await reviewers.update(reviewerId, { availability: 'paused' })
    // Leaving the directory is leaving the org, so it ends their sessions as a pause by an admin does.
    await sessions.revokeForReviewer(reviewerId)
  }
  return plan.update.length + plan.create.length + plan.pause.length
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
  const owners = new Map<string, string>()
  for (const account of persons.flatMap((person) => person.accounts)) {
    const owner = await container.repositories.identities.findReviewerId(
      account.provider,
      account.subject,
    )
    if (owner !== null) owners.set(accountKey(account), owner)
  }
  return owners
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

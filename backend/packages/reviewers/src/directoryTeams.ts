import type { ExternalGroup, ExternalRef, Team } from '@sainte-beuve/contracts'

/**
 * The teams an external directory's groups become.
 *
 * A group maps to the team that follows it, or adopts a team an admin already
 * made under the same name, or becomes a new team. A team that follows a group
 * the directory no longer lists is removed. Names stay unique the way the store
 * requires: a group whose name another team holds is suffixed with its id, and
 * the suffix goes on the next sync that finds the name free.
 */
export interface DirectoryTeamPlan {
  create: { name: string; external: ExternalRef }[]
  /** A rename, an adoption, or both: `previousName` is what reviewers in it carry now. */
  update: { teamId: string; previousName: string; name: string; external: ExternalRef }[]
  remove: { teamId: string; name: string }[]
  /** The team name each listed group lands under, by group id. */
  nameByGroup: Map<string, string>
}

const nameKey = (name: string): string => name.trim().toLowerCase()

function follows(team: Team, source: string, groupId?: string): boolean {
  if (team.external === null || team.external === undefined) return false
  return team.external.source === source && (groupId === undefined || team.external.id === groupId)
}

export function planDirectoryTeams(
  source: string,
  teams: readonly Team[],
  groups: readonly ExternalGroup[],
): DirectoryTeamPlan {
  const listed = new Set(groups.map((group) => group.id))
  const remove = teams
    .filter((team) => follows(team, source) && !listed.has(team.external?.id ?? ''))
    .map((team) => ({ teamId: team.id, name: team.name }))
  const removed = new Set(remove.map((step) => step.teamId))
  const kept = teams.filter((team) => !removed.has(team.id))

  const plan: DirectoryTeamPlan = { create: [], update: [], remove, nameByGroup: new Map() }
  const assigned = new Set<string>()
  const claimed = new Set<string>()
  const ordered = [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const group of ordered) {
    const external = { source, id: group.id }
    const team = kept.find((t) => follows(t, source, group.id)) ?? adoptable(kept, group, claimed)
    const name = uniqueName(group, kept, assigned, team?.id ?? null)
    assigned.add(nameKey(name))
    plan.nameByGroup.set(group.id, name)
    if (team === undefined) {
      plan.create.push({ name, external })
      continue
    }
    claimed.add(team.id)
    if (team.name !== name || !follows(team, source, group.id)) {
      plan.update.push({ teamId: team.id, previousName: team.name, name, external })
    }
  }
  return plan
}

/** A team nobody's directory follows, holding the group's name. */
function adoptable(
  teams: readonly Team[],
  group: ExternalGroup,
  claimed: ReadonlySet<string>,
): Team | undefined {
  return teams.find(
    (team) =>
      !claimed.has(team.id) &&
      (team.external === null || team.external === undefined) &&
      nameKey(team.name) === nameKey(group.name),
  )
}

/** The group's name, unless another team holds it or a group earlier in this plan took it. */
function uniqueName(
  group: ExternalGroup,
  teams: readonly Team[],
  assigned: ReadonlySet<string>,
  ownTeamId: string | null,
): string {
  const key = nameKey(group.name)
  const heldElsewhere = teams.some((team) => team.id !== ownTeamId && nameKey(team.name) === key)
  return heldElsewhere || assigned.has(key) ? `${group.name} (${group.id})` : group.name
}

import type { Team } from '@sainte-beuve/contracts'

/** Who is acting on a team: the reviewer behind the request, if any, and whether they administer the org. */
export interface TeamActor {
  reviewerId: string | null
  admin: boolean
}

/** What a request wants to do to a team. */
export type TeamAction =
  | { kind: 'create'; ownerId: string | null }
  | { kind: 'change'; team: Team; newOwnerId?: string | null }

export type TeamDecision = { allowed: true } | { allowed: false; reason: string }

const ALLOWED: TeamDecision = { allowed: true }

/**
 * Whether an actor may create, rename, hand over or delete a team.
 *
 * Anyone with a reviewer row may create a team they own. Owning a team lets
 * you rename it, delete it and hand it to somebody else. An admin may do all
 * of that to any team, and may create one owned by somebody else or by nobody.
 */
export function decideTeamAction(actor: TeamActor, action: TeamAction): TeamDecision {
  if (actor.admin) return ALLOWED
  if (actor.reviewerId === null) {
    return refuse('Only a person can own a team. Sign in, or ask an admin to create it.')
  }
  if (action.kind === 'create') {
    return action.ownerId === actor.reviewerId
      ? ALLOWED
      : refuse('Only an admin can create a team for somebody else.')
  }
  return action.team.ownerId === actor.reviewerId
    ? ALLOWED
    : refuse("Only the team's owner or an admin can change it.")
}

/** The owner a new team gets when the request names none: whoever created it. */
export function ownerOfNewTeam(
  actor: TeamActor,
  requested: string | null | undefined,
): string | null {
  return requested === undefined ? actor.reviewerId : requested
}

function refuse(reason: string): TeamDecision {
  return { allowed: false, reason }
}

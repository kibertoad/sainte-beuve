import type { CreateTeam, Team, UpdateTeam } from '@sainte-beuve/contracts'
import {
  assertFound,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@sainte-beuve/kernel'
import {
  decideTeamAction,
  ownerOfNewTeam,
  type TeamAction,
  type TeamActor,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/**
 * An org's teams, and the reviewers that name them.
 *
 * A reviewer refers to a team by name, so a rename is written onto every
 * reviewer in the team and a delete takes it off them. An attention request
 * already out keeps the name it captured.
 */
export class TeamService {
  constructor(
    private readonly container: AppContainer,
    private readonly actor: TeamActor,
  ) {}

  async list(): Promise<Team[]> {
    return this.container.repositories.teams.list()
  }

  async create(input: CreateTeam): Promise<Team> {
    const ownerId = ownerOfNewTeam(this.actor, input.ownerId)
    this.authorise({ kind: 'create', ownerId })
    await this.assertReviewer(ownerId)
    const { repositories, ids, clock } = this.container
    const wanted: Team = { id: ids.next(), name: input.name, ownerId, createdAt: clock.now() }
    const written = await repositories.teams.create(wanted)
    if (written.id !== wanted.id) throw nameTaken(written.name)
    return written
  }

  async update(teamId: string, patch: UpdateTeam): Promise<Team> {
    const team = await this.find(teamId)
    this.authorise({ kind: 'change', team, newOwnerId: patch.ownerId })
    if (patch.ownerId !== undefined) await this.assertReviewer(patch.ownerId)
    if (patch.name !== undefined) await this.assertNameFree(patch.name, teamId)
    const updated = assertFound(
      await this.container.repositories.teams.update(teamId, patch),
      `No team ${teamId}`,
    )
    if (updated.name !== team.name) await this.renameOnReviewers(team.name, updated.name)
    return updated
  }

  /** Delete a team, taking it off every reviewer in it. Answers the list as it stands after. */
  async delete(teamId: string): Promise<Team[]> {
    const team = await this.find(teamId)
    this.authorise({ kind: 'change', team })
    await this.container.repositories.teams.delete(teamId)
    await this.renameOnReviewers(team.name, null)
    return this.list()
  }

  private async find(teamId: string): Promise<Team> {
    const team = await this.container.repositories.teams.getById(teamId)
    if (team === null) throw new NotFoundError(`No team ${teamId}`)
    return team
  }

  private authorise(action: TeamAction): void {
    const decision = decideTeamAction(this.actor, action)
    if (!decision.allowed) throw new ForbiddenError(decision.reason)
  }

  private async assertReviewer(reviewerId: string | null): Promise<void> {
    if (reviewerId === null) return
    const reviewer = await this.container.repositories.reviewers.getById(reviewerId)
    if (reviewer === null) throw new ValidationError(`No reviewer ${reviewerId} to own the team.`)
  }

  private async assertNameFree(name: string, teamId: string): Promise<void> {
    const holder = await this.container.repositories.teams.getByName(name)
    if (holder !== null && holder.id !== teamId) throw nameTaken(holder.name)
  }

  private async renameOnReviewers(from: string, to: string | null): Promise<void> {
    const { reviewers } = this.container.repositories
    const key = from.trim().toLowerCase()
    for (const reviewer of await reviewers.list()) {
      if (reviewer.team?.trim().toLowerCase() === key)
        await reviewers.update(reviewer.id, { team: to })
    }
  }
}

/**
 * The team a reviewer's `team` names, spelled as the team spells it. A name no
 * team holds is refused: the list on the Organization screen is the vocabulary.
 */
export async function resolveTeamName(
  container: AppContainer,
  name: string | null,
): Promise<string | null> {
  if (name === null) return null
  const team = await container.repositories.teams.getByName(name)
  if (team === null) {
    throw new ValidationError(
      `No team "${name.trim()}" in this org. Create it on the Organization screen first.`,
    )
  }
  return team.name
}

function nameTaken(name: string): ConflictError {
  return new ConflictError(`A team is already called "${name}" in this org.`)
}

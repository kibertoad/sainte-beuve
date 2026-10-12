import type {
  CreateReviewer,
  Reviewer,
  ReviewerTeamChoices,
  UpdateReviewer,
} from '@sainte-beuve/contracts'
import { assertFound, ConflictError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { repositoryDirectoryAccess } from '../../integrations/resolve.js'
import { SessionService } from '../auth/SessionService.js'
import { resolveTeamName } from '../teams/TeamService.js'
import { directoryTeamNames } from './directorySync.js'

/** The reviewer directory: who is in the pool, what they know, and whether they are free. */
export class ReviewerService {
  constructor(private readonly container: AppContainer) {}

  async list(): Promise<Reviewer[]> {
    return this.container.repositories.reviewers.list()
  }

  async create(input: CreateReviewer): Promise<Reviewer> {
    const { repositories, clock, ids } = this.container
    return repositories.reviewers.create({
      id: ids.next(),
      displayName: input.displayName,
      handles: input.handles,
      slackUserId: input.slackUserId,
      team: await resolveTeamName(this.container, input.team),
      skills: input.skills,
      domains: input.domains,
      availability: input.availability,
      role: input.role,
      weight: input.weight,
      outstandingReviews: 0,
      createdAt: clock.now(),
    })
  }

  /** The teams the reviewer form may offer this person. */
  async teamChoices(reviewerId: string): Promise<ReviewerTeamChoices> {
    const { reviewers, teams } = this.container.repositories
    const reviewer = assertFound(await reviewers.getById(reviewerId), `No reviewer ${reviewerId}`)
    const managed = await this.directoryTeams(reviewer)
    if (managed !== null) return { teams: managed, managed: true }
    return { teams: (await teams.list()).map((team) => team.name), managed: false }
  }

  async update(reviewerId: string, patch: UpdateReviewer): Promise<Reviewer> {
    const { reviewers } = this.container.repositories
    const current = assertFound(await reviewers.getById(reviewerId), `No reviewer ${reviewerId}`)
    await this.refuseWhatTheDirectoryOwns(current, patch)
    const team =
      patch.team === undefined ? {} : { team: await resolveTeamName(this.container, patch.team) }
    const updated = assertFound(
      await reviewers.update(reviewerId, { ...patch, ...team }),
      `No reviewer ${reviewerId}`,
    )
    // PAUSING SOMEBODY SIGNS THEM OUT.
    //
    // `deleteForReviewer` existed on the session port from the day sessions did
    // and nothing called it, because what pausing should mean for ACCESS — as
    // opposed to for selection — was a policy question slice 6a did not answer.
    // This is the answer. `paused` is the only way out of the directory (there
    // is no delete, on purpose), so it is the only thing this deployment has
    // that means "not them, for now", and a state that left a live cookie behind
    // would mean it never meant that at all.
    //
    // A DEMOTION deliberately does not, because it does not have to: the role is
    // read off the reviewer row on the requests that consult it, so it takes
    // effect at once, and signing somebody out of a board they may still read
    // would be a second thing happening for no reason.
    //
    // AFTER the write rather than before: a revocation that raced the update
    // would drop the sessions of somebody the patch then failed to change.
    if (patch.availability === 'paused') {
      await new SessionService(this.container).revokeForReviewer(reviewerId)
    }
    return updated
  }

  /**
   * While a directory follows this reviewer it owns their name and handles, and
   * their team is one of the teams its groups put them in: a change here would
   * be undone by the next sync. Everything else stays editable.
   */
  private async refuseWhatTheDirectoryOwns(reviewer: Reviewer, patch: UpdateReviewer) {
    if (!(await this.followed(reviewer))) return
    if (movesNameOrHandles(reviewer, patch)) {
      throw new ConflictError(
        `${reviewer.displayName} comes from cat-factory, so their name and handles are changed ` +
          'there. Skills, domains, weight, availability and Slack stay editable here.',
        { reason: 'reviewer_managed_externally' },
      )
    }
    if (patch.team === undefined || sameTeam(patch.team, reviewer.team)) return
    await this.refuseTeamOutsideDirectory(reviewer, patch.team)
  }

  /** Whether a directory this org follows owns the reviewer's name, handles and team now. */
  private async followed(reviewer: Reviewer): Promise<boolean> {
    if (reviewer.external === null || reviewer.external === undefined) return false
    return (await repositoryDirectoryAccess(this.container)) !== null
  }

  /** The teams a followed reviewer's groups give them, or null for one no directory follows. */
  private async directoryTeams(reviewer: Reviewer): Promise<string[] | null> {
    if (!(await this.followed(reviewer)) || !reviewer.external) return null
    return directoryTeamNames(this.container, reviewer.external)
  }

  private async refuseTeamOutsideDirectory(reviewer: Reviewer, team: string | null): Promise<void> {
    const allowed = (await this.directoryTeams(reviewer)) ?? []
    if (allowed.some((name) => sameTeam(name, team))) return
    throw new ConflictError(
      allowed.length === 0
        ? `${reviewer.displayName} is in no cat-factory workspace, so their team is set there.`
        : `${reviewer.displayName}'s team is one of their cat-factory workspaces: ${allowed.join(', ')}.`,
      { reason: 'reviewer_managed_externally' },
    )
  }
}

function movesNameOrHandles(reviewer: Reviewer, patch: UpdateReviewer): boolean {
  if (patch.displayName !== undefined && patch.displayName !== reviewer.displayName) return true
  if (patch.handles === undefined) return false
  return (
    patch.handles.github !== reviewer.handles.github ||
    patch.handles.gitlab !== reviewer.handles.gitlab
  )
}

function sameTeam(a: string | null, b: string | null): boolean {
  return (a?.trim().toLowerCase() ?? null) === (b?.trim().toLowerCase() ?? null)
}

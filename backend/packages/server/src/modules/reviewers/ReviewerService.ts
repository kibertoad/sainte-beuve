import type { CreateReviewer, Reviewer, UpdateReviewer } from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { SessionService } from '../auth/SessionService.js'

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
      team: input.team,
      skills: input.skills,
      availability: input.availability,
      role: input.role,
      weight: input.weight,
      outstandingReviews: 0,
      createdAt: clock.now(),
    })
  }

  async update(reviewerId: string, patch: UpdateReviewer): Promise<Reviewer> {
    const updated = assertFound(
      await this.container.repositories.reviewers.update(reviewerId, patch),
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
}

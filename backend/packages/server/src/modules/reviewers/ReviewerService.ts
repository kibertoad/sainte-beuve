import type { CreateReviewer, Reviewer, UpdateReviewer } from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'

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
      githubLogin: input.githubLogin,
      slackUserId: input.slackUserId,
      skills: input.skills,
      availability: input.availability,
      weight: input.weight,
      outstandingReviews: 0,
      createdAt: clock.now(),
    })
  }

  async update(reviewerId: string, patch: UpdateReviewer): Promise<Reviewer> {
    return assertFound(
      await this.container.repositories.reviewers.update(reviewerId, patch),
      `No reviewer ${reviewerId}`,
    )
  }
}

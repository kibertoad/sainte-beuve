import type { PullRequestsToReview, Reviewer } from '@sainte-beuve/contracts'
import { handleOf, MAX_PULL_REQUESTS_TO_REVIEW } from '@sainte-beuve/contracts'
import type { AuthorTally, VcsGateway } from '@sainte-beuve/kernel'
import {
  isReviewableBy,
  isSameHandle,
  pastReviewCounts,
  rankPullRequestsToReview,
  type RepositoryToReview,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { readRepositoryActivity } from '../reviewers/pastReviews.js'
import { gatewaysByProvider, type ProjectRead, sweepProjects } from '../workspace/sweep.js'

/**
 * PRs to review: the open pull requests in the linked repositories the viewer
 * is best placed to review next.
 *
 * The linked projects are swept as the workspace sweeps them. Only a project
 * with something left to rank is asked more: who reviewed its open pull
 * requests, and who was active in it lately. Both reads are best-effort, so a
 * host that will not answer them still lists its pull requests, unranked by
 * what it did not say.
 */
export class ToReviewService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async list(): Promise<PullRequestsToReview> {
    const resolutions = new VcsResolutions(this.container)
    const viewer = await new ViewerService(this.container, this.principal, resolutions).current()
    const { repositories } = this.container
    const projects = await repositories.projects.list()
    const reads = await sweepProjects(this.container, resolutions, projects)
    const candidates = reads.filter((read) =>
      read.pullRequests.some((pr) => isReviewableBy(pr, viewer.reviewer)),
    )
    const gateways = await gatewaysByProvider(
      resolutions,
      candidates.map((read) => read.project),
    )
    const [repositoriesToReview, commitments] = await Promise.all([
      Promise.all(
        candidates.map((read) =>
          this.repositoryToReview(read, {
            viewer: viewer.reviewer,
            gateway: gateways.get(read.project.provider) ?? null,
          }),
        ),
      ),
      repositories.commitments.listByPullRequests(
        candidates.flatMap((read) => read.pullRequests.map((pr) => pr.pullRequest)),
      ),
    ])
    return {
      pullRequests: rankPullRequestsToReview({
        viewer: viewer.reviewer,
        repositories: repositoriesToReview,
        commitments,
        now: this.container.clock.now(),
        limit: MAX_PULL_REQUESTS_TO_REVIEW,
      }),
      sources: reads.map((read) => read.source),
    }
  }

  private async repositoryToReview(
    read: ProjectRead,
    context: { viewer: Reviewer; gateway: VcsGateway | null },
  ): Promise<RepositoryToReview> {
    const { viewer, gateway } = context
    const { project } = read
    const [reviewers, activity] = await Promise.all([
      this.openReviews(read, gateway),
      readRepositoryActivity(this.container, project, gateway),
    ])
    return {
      project,
      pullRequests: read.pullRequests,
      reviewers,
      pastReviews:
        pastReviewCounts(activity.history, [viewer], project.provider).get(viewer.id) ?? 0,
      authored: authoredBy(activity.authors, handleOf(viewer.handles, project.provider)),
    }
  }

  /** Who reviewed each open pull request, or nothing known when the host would not say. */
  private async openReviews(
    read: ProjectRead,
    gateway: VcsGateway | null,
  ): Promise<Map<number, string[]>> {
    if (gateway === null) return new Map()
    try {
      const reviews = await gateway.openPullRequestReviews(read.project)
      return new Map(reviews.map((entry) => [entry.number, entry.reviewerLogins]))
    } catch (err) {
      this.container.logger.warn(
        { err, projectId: read.project.id },
        'could not read who reviewed the open pull requests of a project',
      )
      return new Map()
    }
  }
}

function authoredBy(authors: readonly AuthorTally[], handle: string | null): number {
  return authors
    .filter((tally) => isSameHandle(handle, tally.login))
    .reduce((sum, tally) => sum + tally.pullRequests, 0)
}

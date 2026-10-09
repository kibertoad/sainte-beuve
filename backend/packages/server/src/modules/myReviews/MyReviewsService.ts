import type { MyReviews, MyReviewsQuery } from '@sainte-beuve/contracts'
import { assembleReviewLists, partitionForViewer } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { searchHosts } from '../workspace/search.js'
import { sweepProjects } from '../workspace/sweep.js'

/**
 * Other people's pull requests the viewer has a part in: asked to review,
 * committed to here, or reviewed already.
 *
 * The registered projects are swept as the workspace sweeps them, because that
 * read works with an App installation and is not subject to the search's lag.
 * The hosts are searched on top of it for everything outside them, and for
 * what the viewer has reviewed, which no list endpoint reports.
 */
export class MyReviewsService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async list(query: MyReviewsQuery): Promise<MyReviews> {
    const resolutions = new VcsResolutions(this.container)
    const viewer = await new ViewerService(this.container, this.principal, resolutions).current()
    const { repositories } = this.container
    const projects = await repositories.projects.list()
    const [reads, search, commitments] = await Promise.all([
      sweepProjects(this.container, resolutions, projects),
      // The linked view still searches: a review the viewer gave in a registered
      // repository is only known to the search.
      searchHosts(this.container, resolutions, viewer, ['review_requested', 'reviewed']),
      repositories.commitments.listByReviewer(viewer.reviewer.id),
    ])
    const found = (role: 'review_requested' | 'reviewed') =>
      search.found.filter((hit) => hit.role === role).map((hit) => hit.pullRequest)
    const lists = assembleReviewLists(
      {
        requestedInProjects: partitionForViewer(
          reads.flatMap((read) => read.pullRequests),
          viewer.reviewer.handles,
        ).reviewRequested,
        requestedFound: found('review_requested'),
        reviewedFound: found('reviewed'),
        commitments,
        projects,
      },
      query,
    )
    return { ...lists, sources: reads.map((read) => read.source), searches: search.searches }
  }
}

import type { Workspace } from '@sainte-beuve/contracts'
import { partitionForViewer } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { sweepProjects } from './sweep.js'

/**
 * The main working space, assembled from one sweep of the registered projects.
 *
 * Every project is read ONCE and the result cut three ways, because both hosts
 * return the author and the requested reviewers on the same page: asking per
 * role would double the rate-limit cost of a screen and give two halves from
 * two different moments. The cutting itself is pure (`partitionForViewer`), and
 * the fetching is `sweepProjects`.
 */
export class WorkspaceService {
  constructor(
    private readonly container: AppContainer,
    /** Who the sweep is being cut for. See `ViewerService`. */
    private readonly principal: RequestPrincipal,
  ) {}

  async read(): Promise<Workspace> {
    // One resolution cache for the whole read: the viewer and the sweep both
    // need this deployment's credential for a host, and each resolution opens a
    // sealed envelope.
    const resolutions = new VcsResolutions(this.container)
    const viewer = await new ViewerService(this.container, this.principal, resolutions).current()
    const projects = await this.container.repositories.projects.list()
    const reads = await sweepProjects(this.container, resolutions, projects)
    const pullRequests = reads.flatMap((read) => read.pullRequests)
    // The whole MAP of handles, not a flat list: each pull request is matched
    // against the name the viewer holds on its own host, so a stranger who
    // happens to be called what the viewer is called on the other host stays
    // off this screen.
    const { authored, reviewRequested } = partitionForViewer(pullRequests, viewer.reviewer.handles)
    return {
      viewer,
      authored,
      reviewRequested,
      committed: await this.container.repositories.commitments.listByReviewer(viewer.reviewer.id),
      sources: reads.map((read) => read.source),
    }
  }
}

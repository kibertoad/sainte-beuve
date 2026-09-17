import type {
  OpenPullRequest,
  Project,
  VcsProvider,
  Workspace,
  WorkspaceSource,
} from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import { partitionForViewer } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'

/**
 * The main working space, assembled from one sweep of the registered projects.
 *
 * Every project is read ONCE and the result cut three ways, because both hosts
 * return the author and the requested reviewers on the same page: asking per
 * role would double the rate-limit cost of a screen and give two halves from
 * two different moments. The cutting itself is pure (`partitionForViewer`), so
 * this file only owns the fetching and what to say when a fetch fails.
 *
 * A project that cannot be read does not fail the call. A deployment
 * legitimately holds one host's credential and not the other's, and a
 * workspace that 503s because of the second project is a workspace nobody can
 * use for the first. The reason travels back per project instead.
 */

const NO_CREDENTIAL =
  'no credential for this host: connect it on the Configuration screen, or set its token on the deployment'

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
    const gateways = await this.gatewaysByProvider(resolutions, projects)

    const reads = await Promise.all(
      projects.map((project) => this.readProject(project, gateways.get(project.provider) ?? null)),
    )
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

  /**
   * One gateway per host, resolved once for the whole read rather than per
   * project, and through the same cache the viewer used. Resolution opens a
   * sealed credential, and doing that per project would be one HKDF derivation
   * per repository on a screen somebody refreshes.
   */
  private async gatewaysByProvider(
    resolutions: VcsResolutions,
    projects: readonly Project[],
  ): Promise<Map<VcsProvider, VcsGateway>> {
    const providers = [...new Set(projects.map((project) => project.provider))]
    const resolved = await Promise.all(
      providers.map(async (provider) => [provider, await resolutions.acting(provider)] as const),
    )
    const gateways = new Map<VcsProvider, VcsGateway>()
    for (const [provider, entry] of resolved) {
      if (entry !== null) gateways.set(provider, entry.gateway)
    }
    return gateways
  }

  private async readProject(
    project: Project,
    gateway: VcsGateway | null,
  ): Promise<{ pullRequests: OpenPullRequest[]; source: WorkspaceSource }> {
    if (gateway === null) return { pullRequests: [], source: sourceOf(project, NO_CREDENTIAL) }
    try {
      return {
        pullRequests: await gateway.listOpenPullRequests(project),
        source: sourceOf(project),
      }
    } catch (err) {
      this.container.logger.warn(
        { err, projectId: project.id },
        'could not list the open pull requests of a project',
      )
      return { pullRequests: [], source: sourceOf(project, getErrorMessage(err)) }
    }
  }
}

function sourceOf(project: Project, reason?: string): WorkspaceSource {
  return {
    projectId: project.id,
    provider: project.provider,
    owner: project.owner,
    repo: project.repo,
    ok: reason === undefined,
    reason: reason ?? null,
  }
}

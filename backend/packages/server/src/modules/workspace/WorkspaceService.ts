import type {
  OpenPullRequest,
  Project,
  VcsProvider,
  Workspace,
  WorkspaceSource,
} from '@sainte-beuve/contracts'
import { knownHandles } from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import { partitionForViewer } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'
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
  constructor(private readonly container: AppContainer) {}

  async read(): Promise<Workspace> {
    const viewer = await new ViewerService(this.container).current()
    const projects = await this.container.repositories.projects.list()
    const gateways = await this.gatewaysByProvider(projects)

    const reads = await Promise.all(
      projects.map((project) => this.readProject(project, gateways.get(project.provider) ?? null)),
    )
    const pullRequests = reads.flatMap((read) => read.pullRequests)
    const { authored, reviewRequested } = partitionForViewer(
      pullRequests,
      knownHandles(viewer.reviewer.handles),
    )
    return {
      viewer,
      authored,
      reviewRequested,
      committed: await this.container.repositories.commitments.listByReviewer(viewer.reviewer.id),
      sources: reads.map((read) => read.source),
    }
  }

  /**
   * One gateway per host, resolved once for the whole sweep rather than per
   * project. Resolution opens a sealed credential, and doing that per project
   * would be one HKDF derivation per repository on a screen somebody refreshes.
   */
  private async gatewaysByProvider(
    projects: readonly Project[],
  ): Promise<Map<VcsProvider, VcsGateway>> {
    const providers = [...new Set(projects.map((project) => project.provider))]
    const resolved = await Promise.all(
      providers.map(
        async (provider) => [provider, await resolveVcs(this.container, provider)] as const,
      ),
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

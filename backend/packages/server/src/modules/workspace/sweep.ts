import {
  hostSnapshotSchemas,
  type OpenPullRequest,
  type Project,
  snapshotDecoder,
  type VcsProvider,
  type WorkspaceSource,
} from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import { mapWithConcurrency } from '../../concurrency.js'
import type { AppContainer } from '../../container.js'
import {
  openPullRequestsKey,
  readThroughSnapshot,
  SNAPSHOT_MAX_AGE,
} from '../../integrations/hostSnapshots.js'
import type { VcsResolutions } from '../../integrations/resolve.js'

/**
 * One read of the open pull requests in a set of registered projects, shared by
 * the workspace and My PRs.
 *
 * A project that cannot be read does not fail the sweep. A deployment
 * legitimately holds one host's credential and not the other's, and a screen
 * that 503s because of the second project is a screen nobody can use for the
 * first. The reason travels back per project instead.
 */

export const NO_CREDENTIAL =
  'no credential for this host: connect it on the Configuration screen, or set its token on the deployment'

/** Repositories read at once. GitHub's secondary rate limit punishes a burst, not a total. */
export const HOST_READ_CONCURRENCY = 4

export const decodeOpenPullRequests = snapshotDecoder(hostSnapshotSchemas.openPullRequests)

export interface ProjectRead {
  project: Project
  pullRequests: OpenPullRequest[]
  source: WorkspaceSource
}

export async function sweepProjects(
  container: AppContainer,
  resolutions: VcsResolutions,
  projects: readonly Project[],
): Promise<ProjectRead[]> {
  const gateways = await gatewaysByProvider(resolutions, projects)
  return mapWithConcurrency(projects, HOST_READ_CONCURRENCY, (project) =>
    readProject(container, project, gateways.get(project.provider) ?? null),
  )
}

/**
 * One gateway per host, resolved once for the whole read rather than per
 * project. Resolution opens a sealed credential, and doing that per project
 * would be one HKDF derivation per repository on a screen somebody refreshes.
 */
export async function gatewaysByProvider(
  resolutions: VcsResolutions,
  projects: readonly Pick<Project, 'provider'>[],
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

async function readProject(
  container: AppContainer,
  project: Project,
  gateway: VcsGateway | null,
): Promise<ProjectRead> {
  if (gateway === null) {
    return { project, pullRequests: [], source: sourceOf(project, NO_CREDENTIAL) }
  }
  try {
    const pullRequests = await readThroughSnapshot(container, {
      source: project.provider,
      key: openPullRequestsKey(project),
      maxAgeMs: SNAPSHOT_MAX_AGE.openPullRequests,
      decode: decodeOpenPullRequests,
      fetch: () => gateway.listOpenPullRequests(project),
    })
    return { project, pullRequests, source: sourceOf(project) }
  } catch (err) {
    container.logger.warn(
      { err, projectId: project.id },
      'could not list the open pull requests of a project',
    )
    return { project, pullRequests: [], source: sourceOf(project, getErrorMessage(err)) }
  }
}

export function sourceOf(project: Project, reason?: string): WorkspaceSource {
  return {
    projectId: project.id,
    provider: project.provider,
    owner: project.owner,
    repo: project.repo,
    ok: reason === undefined,
    reason: reason ?? null,
  }
}

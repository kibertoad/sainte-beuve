import { CatFactoryNotFoundError } from '@cat-factory/sdk'
import type { PullRequestRef } from '@sainte-beuve/contracts'
import { formatPullRequest } from '@sainte-beuve/kernel'
import { repositoryMissing } from './catFactoryApp.js'
import type { DirectoryLocation } from './directoryKeys.js'
import { provisionService } from './provisioning.js'
import { repositoryLocations } from './repositoryLocations.js'
import { refusalFor } from './refusals.js'
import type { WorkspaceClients } from './workspaceClients.js'

/** Where a task goes: a service, and the workspace it belongs to. */
export interface Placement {
  serviceId: string
  /** Null for the key's only workspace. */
  workspaceId: string | null
}

export interface PlacementRequest {
  pullRequest: PullRequestRef
  /** The mirror keys the repository is listed under, in the order to prefer them. */
  directoryKeys: readonly string[]
  /** The service a task goes under when none backs its repository. */
  defaultServiceId: string | null
  /** The mirror's keys for the owner's other repositories: where a new one belongs. */
  ownerDirectoryKeys: readonly string[]
  /** Where cat-factory serves its app, asked only when the refusal needs a link into it. */
  appUrl: () => Promise<string>
}

/**
 * The service that backs the pull request's repository in a workspace linking
 * it, else the default service, in whichever linking workspace holds it. A
 * repository no workspace links is first linked and given a service of its own
 * (`provisionService`), so it is registered rather than filed under another
 * repository's service. The linking workspaces are the mirror's, else
 * cat-factory's directory's (`repositoryLocations`).
 *
 * The first key whose workspace backs the repository wins, so a lookup refused
 * in one workspace does not stop filing when another backs it. A repository no
 * workspace backs (a monorepo never is, since it can back several) falls back to
 * the default, but only once every linking workspace has answered: filing under
 * the default because the key could not read a workspace would put the task
 * under another repository's service without saying so.
 */
export async function placeTask(
  clients: WorkspaceClients,
  request: PlacementRequest,
): Promise<Placement> {
  const { pullRequest, defaultServiceId } = request
  const locations = (await repositoryLocations(clients, pullRequest, request.directoryKeys)) ?? []
  const lookups = await Promise.allSettled(
    locations.map((location) => backing(clients, location, pullRequest)),
  )
  const backed = lookups.find(
    (lookup): lookup is PromiseFulfilledResult<Placement> =>
      lookup.status === 'fulfilled' && lookup.value !== null,
  )
  if (backed !== undefined) return backed.value
  const refused = lookups.find((lookup) => lookup.status === 'rejected')
  if (refused !== undefined) throw refused.reason
  if (locations.length === 0) {
    const provisioned = await provisionService(clients, {
      pullRequest,
      ownerDirectoryKeys: request.ownerDirectoryKeys,
    })
    if (provisioned !== null) return provisioned
  }
  if (defaultServiceId === null) {
    throw await repositoryMissing(
      pullRequest,
      request.appUrl,
      (repository) =>
        `Cannot file a cat-factory task for ${formatPullRequest(pullRequest)}: no cat-factory service backs its repository and no default service is set. ` +
        `Add ${repository} as a service in cat-factory, or set a default service id on the Configuration screen`,
    )
  }
  const workspaces = [...new Set(locations.map((location) => location.workspaceId))]
  return {
    serviceId: defaultServiceId,
    workspaceId: await workspaceHolding(clients, defaultServiceId, workspaces),
  }
}

/**
 * The service backing one linked repository, or null when none does. Matched
 * on the provider as well as the id, because a GitHub repository and a GitLab
 * project can share a numeric id inside one workspace. A workspace cat-factory
 * no longer has backs nothing, which a mirror key outliving it can name.
 */
async function backing(
  clients: WorkspaceClients,
  location: DirectoryLocation,
  pullRequest: PullRequestRef,
): Promise<Placement | null> {
  try {
    const { repos } = await clients.in(location.workspaceId).repos.list()
    const linked = repos.find(
      (repo) => repo.repoId === location.repoId && repo.provider === pullRequest.provider,
    )
    const serviceId = linked?.serviceId ?? null
    return serviceId === null ? null : { serviceId, workspaceId: location.workspaceId }
  } catch (err) {
    if (err instanceof CatFactoryNotFoundError) return null
    throw refusalFor(err, `find the service that backs ${formatPullRequest(pullRequest)}`)
  }
}

/**
 * The first linking workspace that holds the default service, else null for
 * the key's only workspace. Naming it is what lets a key reaching several
 * workspaces file a monorepo's task at all.
 */
async function workspaceHolding(
  clients: WorkspaceClients,
  serviceId: string,
  workspaces: readonly string[],
): Promise<string | null> {
  const listed = await Promise.all(
    workspaces.map(async (workspaceId) => {
      try {
        const { services } = await clients.in(workspaceId).services.list()
        return services.some((service) => service.serviceId === serviceId)
      } catch (err) {
        throw refusalFor(err, `find the workspace that holds the default service ${serviceId}`)
      }
    }),
  )
  return workspaces.find((_, index) => listed[index]) ?? null
}

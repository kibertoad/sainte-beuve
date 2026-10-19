import type { PullRequestRef } from '@sainte-beuve/contracts'
import { type DirectoryLocation, locationOf } from './directoryKeys.js'
import type { WorkspaceClients } from './workspaceClients.js'

/**
 * Where cat-factory links the pull request's repository: the places the
 * mirror's keys name, else cat-factory's own directory read now, because the
 * mirror lags a repository linked since its last pass.
 *
 * Null when the mirror names none and the key may not read the directory, so
 * the caller cannot tell an unlinked repository from an unknown one.
 */
export async function repositoryLocations(
  clients: WorkspaceClients,
  pullRequest: PullRequestRef,
  directoryKeys: readonly string[],
): Promise<DirectoryLocation[] | null> {
  const mirrored = directoryKeys
    .map(locationOf)
    .filter((location): location is DirectoryLocation => location !== null)
  if (mirrored.length > 0) return mirrored
  try {
    const found: DirectoryLocation[] = []
    for await (const repo of clients.in(null).directory.listReposAll()) {
      if (
        repo.provider === pullRequest.provider &&
        sameName(repo.owner, pullRequest.owner) &&
        sameName(repo.name, pullRequest.repo)
      ) {
        found.push({ workspaceId: repo.workspaceId, repoId: repo.repoId })
      }
    }
    return found.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
  } catch {
    return null
  }
}

/** GitHub and GitLab both treat owner and repository names case-insensitively. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

import type { PullRequestRef } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { CAT_FACTORY_SOURCE } from './RepositorySyncService.js'

/**
 * The keys cat-factory's directory lists a pull request's repository under, one
 * per workspace that links it, read from this org's mirror of the directory.
 *
 * Matched on the provider, then on the host's repository id when the project
 * came from the directory, because that survives a rename the mirror has not
 * caught up with; otherwise on the owner and name. A project registered here
 * goes by name until the sync's next pass adopts it, so only that window can
 * miss a rename. An org that has not connected cat-factory holds no mirror and
 * gets no keys. Sorted, because the stores list in no set order and the
 * gateway files in the first workspace that backs the repository, so the same
 * repository lands in the same one.
 */
export async function catFactoryDirectoryKeys(
  container: AppContainer,
  pullRequest: PullRequestRef,
): Promise<string[]> {
  const { projects, externalRepositories } = container.repositories
  const [project, entries] = await Promise.all([
    projects.getByRef(pullRequest),
    externalRepositories.list(CAT_FACTORY_SOURCE),
  ])
  const externalId = project?.external?.source === CAT_FACTORY_SOURCE ? project.external.id : null
  return entries
    .filter(({ repository }) => {
      if (repository === null || repository.provider !== pullRequest.provider) return false
      if (externalId !== null) return repository.id === externalId
      return (
        sameName(repository.owner, pullRequest.owner) && sameName(repository.repo, pullRequest.repo)
      )
    })
    .map((entry) => entry.key)
    .sort()
}

/** GitHub and GitLab both treat owner and repository names case-insensitively. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

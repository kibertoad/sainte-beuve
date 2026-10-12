import type { ProjectRef } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'

/** The source the cat-factory directory is mirrored under. The store and the sync planner take any. */
export const CAT_FACTORY_SOURCE = 'cat-factory'

/**
 * The keys cat-factory's directory lists a repository under, one per workspace
 * that links it, read from this org's mirror of the directory. The keys are
 * opaque here: only the cat-factory gateways read a workspace out of one.
 *
 * Matched on the host's repository id when the project came from the
 * directory, because that survives a rename the mirror has not caught up with;
 * otherwise on the owner and name. An org that has not connected cat-factory
 * holds no mirror and gets no keys.
 */
export async function directoryKeysFor(
  container: AppContainer,
  ref: ProjectRef,
): Promise<string[]> {
  const { projects, externalRepositories } = container.repositories
  const [project, entries] = await Promise.all([
    projects.getByRef(ref),
    externalRepositories.list(CAT_FACTORY_SOURCE),
  ])
  const externalId = project?.external?.source === CAT_FACTORY_SOURCE ? project.external.id : null
  return entries
    .filter(({ repository }) => {
      if (repository === null) return false
      if (externalId !== null) return repository.id === externalId
      return (
        repository.provider === ref.provider &&
        sameName(repository.owner, ref.owner) &&
        sameName(repository.repo, ref.repo)
      )
    })
    .map((entry) => entry.key)
}

/** Every key this org's mirror holds a linked repository under, across all its workspaces. */
export async function orgDirectoryKeys(container: AppContainer): Promise<string[]> {
  const entries = await container.repositories.externalRepositories.list(CAT_FACTORY_SOURCE)
  return entries.filter((entry) => entry.repository !== null).map((entry) => entry.key)
}

/** GitHub and GitLab both treat owner and repository names case-insensitively. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

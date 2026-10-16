import type { ExternalRepository, ProjectRef } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { CAT_FACTORY_SOURCE } from './RepositorySyncService.js'

/**
 * The keys cat-factory's directory lists a repository under, one per workspace
 * that links it, read from this org's mirror of the directory.
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
  ref: ProjectRef,
): Promise<string[]> {
  return (await catFactoryPlacementKeys(container, ref)).directoryKeys
}

/**
 * The repository's keys, and the keys of the owner's other repositories, which
 * is where cat-factory is told to link the repository when no workspace does.
 */
export async function catFactoryPlacementKeys(
  container: AppContainer,
  ref: ProjectRef,
): Promise<{ directoryKeys: string[]; ownerDirectoryKeys: string[] }> {
  const { projects, externalRepositories } = container.repositories
  const [project, entries] = await Promise.all([
    projects.getByRef(ref),
    externalRepositories.list(CAT_FACTORY_SOURCE),
  ])
  const externalId = project?.external?.source === CAT_FACTORY_SOURCE ? project.external.id : null
  const listed = entries.filter(
    (
      entry,
    ): entry is ExternalRepository & {
      repository: NonNullable<ExternalRepository['repository']>
    } => entry.repository !== null && entry.repository.provider === ref.provider,
  )
  const isThis = ({ repository }: (typeof listed)[number]): boolean =>
    externalId !== null
      ? repository.id === externalId
      : sameName(repository.owner, ref.owner) && sameName(repository.repo, ref.repo)
  return {
    directoryKeys: keysOf(listed.filter(isThis)),
    ownerDirectoryKeys: keysOf(
      listed.filter((entry) => !isThis(entry) && sameName(entry.repository.owner, ref.owner)),
    ),
  }
}

function keysOf(entries: readonly ExternalRepository[]): string[] {
  return entries.map((entry) => entry.key).sort()
}

/** GitHub and GitLab both treat owner and repository names case-insensitively. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

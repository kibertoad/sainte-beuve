import { entityKey } from '@cat-factory/directory-sync'

/** A repository's place in cat-factory: the workspace that links it, and its id there. */
export interface DirectoryLocation {
  workspaceId: string
  repoId: number
}

/**
 * The workspace and repository a mirror key names.
 *
 * The mirror holds each repository under the key `@cat-factory/directory-sync`
 * gives it, `<workspaceId>/<repoId>`. A key that does not come back out of
 * `entityKey` unchanged is not one of those, so it answers null rather than a
 * guess.
 */
export function locationOf(key: string): DirectoryLocation | null {
  const slash = key.lastIndexOf('/')
  if (slash <= 0) return null
  const workspaceId = key.slice(0, slash)
  const entityId = key.slice(slash + 1)
  if (!/^\d+$/.test(entityId)) return null
  const repoId = Number(entityId)
  if (!Number.isSafeInteger(repoId)) return null
  if (entityKey({ entityType: 'repo', workspaceId, entityId }) !== key) return null
  return { workspaceId, repoId }
}

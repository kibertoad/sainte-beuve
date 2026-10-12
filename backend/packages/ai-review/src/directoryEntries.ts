import type { DirectoryRecord } from '@cat-factory/directory-sync'
import type { ExternalAccount } from '@sainte-beuve/contracts'
import type { ExternalDirectoryEntryInput, ExternalRepositoryEntry } from '@sainte-beuve/kernel'

/**
 * cat-factory's directory records as the mirror stores them: repositories in
 * one list, and people, groups and memberships in the other. A workspace is a
 * group and a workspace membership puts a person in it. An account membership
 * is read past: a user who loses theirs arrives as a dropped user.
 */
export type MirrorEntry =
  | { list: 'repositories'; entry: ExternalRepositoryEntry }
  | { list: 'directory'; entry: ExternalDirectoryEntryInput }

export function mirrorEntryOf(record: DirectoryRecord): MirrorEntry | null {
  const base = { key: record.key, seq: record.seq }
  switch (record.entityType) {
    case 'repo': {
      const repo = record.entity
      const repository =
        repo === null
          ? null
          : { provider: repo.provider, owner: repo.owner, repo: repo.name, id: String(repo.repoId) }
      return { list: 'repositories', entry: { ...base, repository } }
    }
    case 'user': {
      const user = record.entity
      const person =
        user === null ? null : { id: user.id, name: user.name, accounts: accountsOf(user) }
      return { list: 'directory', entry: { ...base, kind: 'person', record: person } }
    }
    case 'workspace': {
      const workspace = record.entity
      const group = workspace === null ? null : { id: workspace.id, name: workspace.name }
      return { list: 'directory', entry: { ...base, kind: 'group', record: group } }
    }
    case 'workspace_membership': {
      const membership = record.entity
      const pair =
        membership === null
          ? null
          : { groupId: membership.workspaceId, personId: membership.userId }
      return { list: 'directory', entry: { ...base, kind: 'membership', record: pair } }
    }
    default:
      return null
  }
}

/** Which mirror list a directory entity type lands in, or null for one the mirror reads past. */
export function mirrorListOf(
  entityType: DirectoryRecord['entityType'],
):
  | { list: 'repositories' }
  | { list: 'directory'; kind: ExternalDirectoryEntryInput['kind'] }
  | null {
  switch (entityType) {
    case 'repo':
      return { list: 'repositories' }
    case 'user':
      return { list: 'directory', kind: 'person' }
    case 'workspace':
      return { list: 'directory', kind: 'group' }
    case 'workspace_membership':
      return { list: 'directory', kind: 'membership' }
    default:
      return null
  }
}

/**
 * The host accounts cat-factory publishes for a user. Read structurally because
 * the field is newer than some instances (kibertoad/cat-factory#2358): an
 * instance without it lists every user with no account, and a provider this
 * build does not know is skipped rather than guessed.
 */
function accountsOf(user: object): ExternalAccount[] {
  const listed: unknown = 'accounts' in user ? user.accounts : undefined
  if (!Array.isArray(listed)) return []
  return listed.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { provider, id, login } = entry as Record<string, unknown>
    if (provider !== 'github' && provider !== 'gitlab') return []
    if (typeof id !== 'string' || id.length === 0) return []
    return [{ provider, subject: id, username: typeof login === 'string' ? login : null }]
  })
}

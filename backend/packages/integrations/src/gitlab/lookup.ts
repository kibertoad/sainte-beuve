import type { RepositoryCandidate, RepositoryLookup } from '@sainte-beuve/contracts'
import { gitlabApiStatusOf } from './client.js'

/** How many suggestions one lookup returns. A short list is what a form can show under a field. */
export const LOOKUP_LIMIT = 10

interface GitLabNamespace {
  id: number
  kind: 'group' | 'user'
}

interface GitLabProject {
  path: string
  description?: string | null
  visibility?: string
}

/**
 * A namespace is a group or a user, and GitLab lists their projects under two
 * different resources. `/namespaces/:path` is the one read that resolves either
 * from the path somebody typed, nested groups included.
 */
export async function lookupGitLabRepositories(
  get: <T>(path: string) => Promise<T>,
  owner: string,
  query: string,
): Promise<RepositoryLookup> {
  const namespace = await namespaceOf(get, owner)
  if (namespace === null) return { ownerFound: false, repositories: [] }
  const collection = namespace.kind === 'group' ? 'groups' : 'users'
  const projects = await get<GitLabProject[]>(
    `/${collection}/${namespace.id}/projects?search=${encodeURIComponent(query)}` +
      `&archived=false&per_page=${LOOKUP_LIMIT}&order_by=last_activity_at`,
  )
  return { ownerFound: true, repositories: projects.map(toCandidate) }
}

async function namespaceOf(
  get: <T>(path: string) => Promise<T>,
  owner: string,
): Promise<GitLabNamespace | null> {
  try {
    return await get<GitLabNamespace>(`/namespaces/${encodeURIComponent(owner)}`)
  } catch (err) {
    if (gitlabApiStatusOf(err) === 404) return null
    throw err
  }
}

function toCandidate(project: GitLabProject): RepositoryCandidate {
  return {
    repo: project.path,
    description: project.description ?? null,
    private: project.visibility !== undefined && project.visibility !== 'public',
  }
}

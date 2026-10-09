import type { RepositoryCandidate, RepositoryLookup } from '@sainte-beuve/contracts'
import { githubApiStatusOf } from './client.js'

/** How many suggestions one lookup returns. A short list is what a form can show under a field. */
export const LOOKUP_LIMIT = 10

interface GitHubRepository {
  name: string
  description?: string | null
  private?: boolean
}

/**
 * The owner first, then the search. Asking for the owner costs a core-API call
 * and spares the search API, whose budget is thirty a minute, a query about an
 * owner that does not exist. GitHub answers that search with a 422 that does not
 * say which part of the query it refused.
 */
export async function lookupGitHubRepositories(
  get: <T>(path: string) => Promise<T>,
  owner: string,
  query: string,
): Promise<RepositoryLookup> {
  if (!(await ownerExists(get, owner))) return { ownerFound: false, repositories: [] }
  const q = encodeURIComponent(`${query} in:name user:${owner} archived:false`)
  const result = await get<{ items: GitHubRepository[] }>(
    `/search/repositories?q=${q}&per_page=${LOOKUP_LIMIT}`,
  )
  return { ownerFound: true, repositories: result.items.map(toCandidate) }
}

/** A GitHub login has no slash, so a nested GitLab-style owner is answered without a request. */
async function ownerExists(get: <T>(path: string) => Promise<T>, owner: string): Promise<boolean> {
  if (owner.includes('/')) return false
  try {
    await get(`/users/${encodeURIComponent(owner)}`)
    return true
  } catch (err) {
    if (githubApiStatusOf(err) === 404) return false
    throw err
  }
}

function toCandidate(repository: GitHubRepository): RepositoryCandidate {
  return {
    repo: repository.name,
    description: repository.description ?? null,
    private: repository.private ?? false,
  }
}

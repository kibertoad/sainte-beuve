import type {
  MyReview,
  MyReviewCommitment,
  MyReviewsQuery,
  OpenPullRequest,
  Project,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { repositoryKey } from './repositories.js'

export interface ReviewListsInput {
  /** Review requests read from the registered projects. */
  requestedInProjects: readonly OpenPullRequest[]
  /** Review requests a host search found, anywhere. */
  requestedFound: readonly OpenPullRequest[]
  reviewedFound: readonly OpenPullRequest[]
  commitments: readonly ReviewCommitment[]
  projects: readonly Project[]
}

export interface ReviewLists {
  requested: MyReview[]
  committed: MyReviewCommitment[]
  reviewed: MyReview[]
}

/**
 * The three My Reviews lists, each row placed in its registered project when it
 * has one, newest activity first.
 *
 * A pull request the host asks the viewer to look at again is still in the
 * reviewed search, and it belongs under `requested`, where the next move is
 * theirs. The project read and the search overlap for every registered
 * repository the search can see, so a row is kept once, by its URL.
 */
export function assembleReviewLists(input: ReviewListsInput, query: MyReviewsQuery): ReviewLists {
  const projectIdOf = projectIndex(input.projects)
  const inScope = (ref: OpenPullRequest['pullRequest']): boolean => {
    if (query.scope === 'linked' && projectIdOf(ref) === null) return false
    return query.owner === undefined || ref.owner.toLowerCase() === query.owner.toLowerCase()
  }
  const toRow = (pr: OpenPullRequest): MyReview => ({
    ...pr,
    projectId: projectIdOf(pr.pullRequest),
  })

  const requested = uniqueByUrl([...input.requestedInProjects, ...input.requestedFound])
  const requestedUrls = new Set(requested.map((pr) => pr.pullRequest.url))
  const reviewed = uniqueByUrl(input.reviewedFound).filter(
    (pr) => !requestedUrls.has(pr.pullRequest.url),
  )
  return {
    requested: byRecency(requested.filter((pr) => inScope(pr.pullRequest))).map(toRow),
    committed: input.commitments
      .filter((commitment) => inScope(commitment.pullRequest))
      .map((commitment) => ({ ...commitment, projectId: projectIdOf(commitment.pullRequest) })),
    reviewed: byRecency(reviewed.filter((pr) => inScope(pr.pullRequest))).map(toRow),
  }
}

function projectIndex(projects: readonly Project[]) {
  const ids = new Map(projects.map((project) => [repositoryKey(project), project.id]))
  return (ref: OpenPullRequest['pullRequest']): string | null => ids.get(repositoryKey(ref)) ?? null
}

function uniqueByUrl(pullRequests: readonly OpenPullRequest[]): OpenPullRequest[] {
  const seen = new Set<string>()
  return pullRequests.filter((pr) => {
    if (seen.has(pr.pullRequest.url)) return false
    seen.add(pr.pullRequest.url)
    return true
  })
}

function byRecency(pullRequests: OpenPullRequest[]): OpenPullRequest[] {
  return pullRequests.sort((a, b) => b.updatedAt - a.updatedAt)
}

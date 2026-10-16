import type {
  MyReview,
  MyReviewCommitment,
  MyReviewsQuery,
  OpenPullRequest,
  PlacedCommitment,
  Project,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { isDependencyBot } from './dependencyBots.js'
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
 * repository the search can see, so a row is kept once, by its URL. A
 * commitment requests its reviewer on the host, so a pull request they
 * committed to is listed under `committed` and not again under `requested`.
 * Dependabot and Renovate pull requests are left out of `requested` and
 * `reviewed` unless the query shows them; a commitment is always kept.
 */
export function assembleReviewLists(input: ReviewListsInput, query: MyReviewsQuery): ReviewLists {
  const projectIdOf = projectIndex(input.projects)
  const inScope = (ref: OpenPullRequest['pullRequest']): boolean => {
    if (query.scope === 'linked' && projectIdOf(ref) === null) return false
    return query.owner === undefined || ref.owner.toLowerCase() === query.owner.toLowerCase()
  }
  const listed = (pr: OpenPullRequest): boolean =>
    inScope(pr.pullRequest) && (query.dependencyBots === 'show' || !isDependencyBot(pr.authorLogin))
  const toRow = (pr: OpenPullRequest): MyReview => ({
    ...pr,
    projectId: projectIdOf(pr.pullRequest),
  })

  const committedUrls = new Set(input.commitments.map((c) => c.pullRequest.url))
  const requested = uniqueByUrl([...input.requestedInProjects, ...input.requestedFound]).filter(
    (pr) => !committedUrls.has(pr.pullRequest.url),
  )
  const requestedUrls = new Set(requested.map((pr) => pr.pullRequest.url))
  const reviewed = uniqueByUrl(input.reviewedFound).filter(
    (pr) => !requestedUrls.has(pr.pullRequest.url),
  )
  return {
    requested: byRecency(requested.filter(listed)).map(toRow),
    committed: placeCommitments(
      input.commitments.filter((commitment) => inScope(commitment.pullRequest)),
      input.projects,
    ),
    reviewed: byRecency(reviewed.filter(listed)).map(toRow),
  }
}

/** Each commitment with the registered project its repository is in, or null for none. */
export function placeCommitments(
  commitments: readonly ReviewCommitment[],
  projects: readonly Project[],
): PlacedCommitment[] {
  const projectIdOf = projectIndex(projects)
  return commitments.map((commitment) => ({
    ...commitment,
    projectId: projectIdOf(commitment.pullRequest),
  }))
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

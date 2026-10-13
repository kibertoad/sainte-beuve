import type {
  OpenPullRequest,
  Project,
  PullRequestToReview,
  Reviewer,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import { repositoryKey } from './repositories.js'
import { isSameHandle, matchesOf, matchTargetFor, affinityOf } from './selection.js'

/**
 * PRs to review: which open pull requests in the linked repositories the viewer
 * is best placed to review next.
 *
 * A promise the viewer made and has not kept yet comes first, whatever its
 * score. The rest are scored. Neglect weighs most: the longer a pull request has
 * gone without any review, the higher it ranks, and nobody having committed to
 * it raises it further. Fit and familiarity weigh less, so a stranger's
 * long-ignored change still outranks a fresh one in the viewer's own corner.
 */

/** How long without a review earns half of the neglect term. */
export const UNREVIEWED_HALF_POINT_MS = 24 * 60 * 60 * 1000

/** The weight of the neglect term, which is 0 to 1 before it. */
export const NEGLECT_WEIGHT = 3

/** What neglect keeps when somebody has committed to the review already. */
export const CLAIMED_NEGLECT_SHARE = 0.5

/** The weight of the share of the repository's skills and domains the viewer holds. */
export const FIT_WEIGHT = 2

/** The weight of the viewer's familiarity with the repository. */
export const FAMILIARITY_WEIGHT = 1

/** Past reviews plus pull requests opened that earn half of the familiarity term. */
export const FAMILIARITY_HALF_POINT = 3

/** The weight of the host waiting on the viewer's review. */
export const REQUESTED_WEIGHT = 1

/** What the host says about the reviews on one open pull request. */
export interface OpenReviews {
  /** The handles that submitted a review. */
  reviewerLogins: readonly string[]
  /**
   * The handles the host is still waiting on: asked, and not answered since.
   * Narrower than the listing's requested reviewers on GitLab, which keeps a
   * reviewer listed after they approve.
   */
  awaitingLogins: readonly string[]
}

/** One linked repository's open pull requests, and the viewer's history in it. */
export interface RepositoryToReview {
  project: Project
  pullRequests: readonly OpenPullRequest[]
  /**
   * The reviews on each open pull request, by number. A number missing was not
   * read, which is not the same as nobody having reviewed it.
   */
  reviews: ReadonlyMap<number, OpenReviews>
  /** Reviews the viewer finished in the repository recently. */
  pastReviews: number
  /** Pull requests the viewer opened in the repository recently. */
  authored: number
}

export interface ToReviewInput {
  viewer: Reviewer
  repositories: readonly RepositoryToReview[]
  /** Everybody's commitments on these pull requests. */
  commitments: readonly ReviewCommitment[]
  now: number
  limit: number
}

type FitReasons = Pick<PullRequestToReview['reasons'], 'matchedSkills' | 'matchedDomains' | 'fit'>

/** Best first: the viewer's own promises, oldest first, then by score. */
export function rankPullRequestsToReview(input: ToReviewInput): PullRequestToReview[] {
  const commitments = commitmentsByPullRequest(input.commitments)
  const rows = input.repositories.flatMap((repository) => {
    const fit = fitOf(input.viewer, repository.project)
    return repository.pullRequests.flatMap((pr) => {
      const row = toReviewRow(input, repository, {
        pr,
        fit,
        commitments: commitments.get(pullRequestKeyOf(pr.pullRequest)) ?? [],
      })
      return row === null ? [] : [row]
    })
  })
  return rows.sort(compareRows).slice(0, input.limit)
}

/** Whether a pull request is one the viewer could be asked to review: not a draft, not their own. */
export function isReviewableBy(pr: OpenPullRequest, viewer: Reviewer): boolean {
  return (
    !pr.draft && !isSameHandle(handleOf(viewer.handles, pr.pullRequest.provider), pr.authorLogin)
  )
}

function fitOf(viewer: Reviewer, project: Project): FitReasons {
  const target = matchTargetFor({ requiredSkills: [] }, project)
  return { ...matchesOf(viewer, target), fit: affinityOf(viewer, target) }
}

function toReviewRow(
  input: ToReviewInput,
  repository: RepositoryToReview,
  subject: { pr: OpenPullRequest; fit: FitReasons; commitments: readonly ReviewCommitment[] },
): PullRequestToReview | null {
  const { viewer, now } = input
  const { pr, commitments } = subject
  if (!isReviewableBy(pr, viewer)) return null
  const handle = handleOf(viewer.handles, pr.pullRequest.provider)
  const review = reviewReasons(pr, repository.reviews.get(pr.pullRequest.number), { handle, now })
  if (review === null) return null

  const reasons = {
    ...commitmentReasons(commitments, viewer.id),
    ...review,
    ...subject.fit,
    pastReviews: repository.pastReviews,
    authored: repository.authored,
  }
  return { ...pr, projectId: repository.project.id, score: scoreOf(reasons), reasons }
}

/**
 * Whether the host is waiting on the viewer, who reviewed already and for how
 * long nobody has. Null when the viewer has nothing left to do on it.
 */
function reviewReasons(
  pr: OpenPullRequest,
  reviews: OpenReviews | undefined,
  context: { handle: string | null; now: number },
): Pick<PullRequestToReview['reasons'], 'requested' | 'reviewerLogins' | 'unreviewedForMs'> | null {
  const { handle, now } = context
  // The listing's requested reviewers stand in only when the reviews were not read.
  const awaiting = reviews?.awaitingLogins ?? pr.requestedReviewerLogins
  const requested = awaiting.some((login) => isSameHandle(handle, login))
  const reviewerLogins = reviews?.reviewerLogins ?? []
  // Reviewed already, and the host is not asking for another look.
  if (!requested && reviewerLogins.some((login) => isSameHandle(handle, login))) return null
  const unreviewedForMs =
    reviews !== undefined && reviewerLogins.length === 0 ? Math.max(0, now - pr.createdAt) : null
  return { requested, reviewerLogins: [...reviewerLogins], unreviewedForMs }
}

function commitmentReasons(
  commitments: readonly ReviewCommitment[],
  viewerId: string,
): Pick<PullRequestToReview['reasons'], 'committedAt' | 'othersCommitted'> {
  const own = commitments.find((commitment) => commitment.reviewerId === viewerId)
  const others = new Set(commitments.map((c) => c.reviewerId).filter((id) => id !== viewerId))
  return { committedAt: own?.createdAt ?? null, othersCommitted: others.size }
}

/** The score a row is ranked on below the viewer's own promises. */
export function scoreOf(reasons: PullRequestToReview['reasons']): number {
  const waited = reasons.unreviewedForMs ?? 0
  const neglect =
    (waited / (waited + UNREVIEWED_HALF_POINT_MS)) *
    (reasons.othersCommitted === 0 ? 1 : CLAIMED_NEGLECT_SHARE)
  const activity = reasons.pastReviews + reasons.authored
  const familiarity = activity / (activity + FAMILIARITY_HALF_POINT)
  return (
    NEGLECT_WEIGHT * neglect +
    FIT_WEIGHT * reasons.fit +
    FAMILIARITY_WEIGHT * familiarity +
    (reasons.requested ? REQUESTED_WEIGHT : 0)
  )
}

function compareRows(a: PullRequestToReview, b: PullRequestToReview): number {
  const promisedA = a.reasons.committedAt
  const promisedB = b.reasons.committedAt
  if (promisedA !== null || promisedB !== null) {
    if (promisedA === null) return 1
    if (promisedB === null) return -1
    if (promisedA !== promisedB) return promisedA - promisedB
  }
  if (b.score !== a.score) return b.score - a.score
  return a.createdAt - b.createdAt
}

function commitmentsByPullRequest(
  commitments: readonly ReviewCommitment[],
): Map<string, ReviewCommitment[]> {
  const grouped = new Map<string, ReviewCommitment[]>()
  for (const commitment of commitments) {
    const key = pullRequestKeyOf(commitment.pullRequest)
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, [commitment])
    else group.push(commitment)
  }
  return grouped
}

function pullRequestKeyOf(ref: OpenPullRequest['pullRequest']): string {
  return `${repositoryKey(ref)}#${ref.number}`
}

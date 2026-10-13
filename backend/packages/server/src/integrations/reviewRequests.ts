import type {
  PullRequestRef,
  Reviewer,
  ReviewCommitment,
  ReviewRequest,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { ACTIVE_REVIEW_STATUSES, handleOf } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../container.js'
import { resolveVcs } from './resolve.js'

/**
 * The review requests on the host, kept in step with who is on the hook here:
 * a board assignment, or somebody's commitment.
 *
 * Best-effort on purpose: the host being down must not lose an assignment or a
 * promise already made here, and the reviewer still hears about it through
 * sainte-beuve. A failure is logged, never thrown.
 */

interface HostFailure<T> {
  message: string
  fields: Record<string, unknown>
  /** What the caller is answered when the host could not be reached. */
  fallback: T
}

async function onHost<T>(
  container: AppContainer,
  pullRequest: PullRequestRef,
  failure: HostFailure<T>,
  act: (vcs: VcsGateway) => Promise<T>,
): Promise<T> {
  try {
    const vcs = await resolveVcs(container, pullRequest.provider)
    if (vcs === null) return failure.fallback
    return await act(vcs.gateway)
  } catch (err) {
    container.logger.warn({ err, ...failure.fields }, failure.message)
    return failure.fallback
  }
}

/**
 * Mirror an assignment onto the pull request: the new reviewers requested, and
 * the ones who no longer hold it withdrawn. The withdrawal goes first, so the
 * last notification the host sends is the one that puts somebody ON the hook.
 */
export async function mirrorAssignment(
  container: AppContainer,
  review: ReviewRequest,
  change: { request: (string | null)[]; withdraw: (string | null)[] },
): Promise<void> {
  const request = known(change.request)
  const withdraw = known(change.withdraw).filter((login) => !request.includes(login))
  if (request.length === 0 && withdraw.length === 0) return
  const failure = {
    message: 'could not mirror the assignment to the PR',
    fields: { reviewId: review.id },
    fallback: undefined,
  }
  await onHost(container, review.pullRequest, failure, async (vcs) => {
    if (withdraw.length > 0) await vcs.removeRequestedReviewers(review.pullRequest, withdraw)
    if (request.length > 0) await vcs.requestReviewers(review.pullRequest, request)
  })
}

/**
 * Request a committed reviewer on the host, unless the host is already waiting
 * on them, and answer the commitment with the request it now holds.
 *
 * The claim is written before the request goes out, so a request that lands is
 * always one the row can take back; a request that does not land drops it.
 */
export async function requestCommittedReviewer(
  container: AppContainer,
  commitment: ReviewCommitment,
  reviewer: Reviewer,
): Promise<ReviewCommitment> {
  const { pullRequest } = commitment
  const { commitments } = container.repositories
  const handle = handleOf(reviewer.handles, pullRequest.provider)
  if (handle === null) return commitment
  const fields = { commitmentId: commitment.id, pullRequest: pullRequest.url }
  const pending = await onHost(
    container,
    pullRequest,
    { message: 'could not read who the PR is waiting on', fields, fallback: null },
    (vcs) => vcs.pendingReviewers(pullRequest),
  )
  if (pending === null || pending.some((login) => isSameHandle(login, handle))) return commitment
  const claimed = await commitments.setRequestedHandle(commitment.id, handle)
  if (claimed === null) return commitment
  const requested = await onHost(
    container,
    pullRequest,
    { message: 'could not request the committed reviewer on the PR', fields, fallback: [] },
    (vcs) => vcs.requestReviewers(pullRequest, [handle]),
  )
  if (requested.some((login) => isSameHandle(login, handle))) return claimed
  return (await commitments.setRequestedHandle(commitment.id, null)) ?? commitment
}

/**
 * Take back the request a released commitment made, if the host is still
 * waiting on it. Somebody who has reviewed since is no longer pending, so their
 * review is never undone, and a board assignment that also names them keeps
 * the request it relies on.
 */
export async function withdrawCommittedReviewer(
  container: AppContainer,
  commitment: ReviewCommitment,
): Promise<void> {
  const { pullRequest, requestedHandle } = commitment
  if (requestedHandle === null) return
  const failure = {
    message: 'could not withdraw the released reviewer from the PR',
    fields: { commitmentId: commitment.id, pullRequest: pullRequest.url },
    fallback: undefined,
  }
  await onHost(container, pullRequest, failure, async (vcs) => {
    if (await isAssignedOnBoard(container, pullRequest, commitment.reviewerId)) return
    const pending = await vcs.pendingReviewers(pullRequest)
    const login = pending.find((entry) => isSameHandle(entry, requestedHandle))
    if (login !== undefined) await vcs.removeRequestedReviewers(pullRequest, [login])
  })
}

async function isAssignedOnBoard(
  container: AppContainer,
  pullRequest: PullRequestRef,
  reviewerId: string,
): Promise<boolean> {
  const review = await container.repositories.reviews.getByPullRequest(pullRequest)
  return (
    review !== null &&
    ACTIVE_REVIEW_STATUSES.includes(review.status) &&
    review.assignedReviewerIds.includes(reviewerId)
  )
}

/**
 * The handles a board release may withdraw on the host. A released reviewer
 * who has also committed to the pull request keeps the request, and their
 * commitment takes it over, so releasing that commitment is what takes it back.
 */
export async function boardWithdrawals(
  container: AppContainer,
  pullRequest: PullRequestRef,
  candidates: Reviewer[],
  released: string[],
): Promise<(string | null)[]> {
  const { commitments } = container.repositories
  const handles = handlesOf(candidates, released, pullRequest.provider)
  const committed = await Promise.all(
    released.map(async (reviewerId, index) => {
      const commitment = await commitments.find(reviewerId, pullRequest)
      if (commitment === null) return false
      const handle = handles[index] ?? null
      if (commitment.requestedHandle === null && handle !== null) {
        await commitments.setRequestedHandle(commitment.id, handle)
      }
      return true
    }),
  )
  return handles.filter((_, index) => !committed[index])
}

/** The named reviewers' handles on the pull request's host. */
function handlesOf(
  candidates: Reviewer[],
  reviewerIds: string[],
  provider: VcsProvider,
): (string | null)[] {
  return reviewerIds.map((id) => {
    const reviewer = candidates.find((r) => r.id === id)
    return reviewer === undefined ? null : handleOf(reviewer.handles, provider)
  })
}

/** A reviewer with no account on that host cannot be mirrored, and is not a failure. */
function known(logins: (string | null)[]): string[] {
  return logins.filter((login): login is string => login !== null)
}

import type { PullRequestRef, Reviewer, ReviewRequest, VcsProvider } from '@sainte-beuve/contracts'
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
 * on them. Answers whether this call is what put the request there, which is
 * the only case in which releasing the commitment may take it back.
 */
export async function requestCommittedReviewer(
  container: AppContainer,
  pullRequest: PullRequestRef,
  handle: string,
): Promise<boolean> {
  const failure = {
    message: 'could not request the committed reviewer on the PR',
    fields: { pullRequest: pullRequest.url },
    fallback: false,
  }
  return onHost(container, pullRequest, failure, async (vcs) => {
    const pending = await vcs.pendingReviewers(pullRequest)
    if (pending.some((login) => isSameHandle(login, handle))) return false
    await vcs.requestReviewers(pullRequest, [handle])
    return true
  })
}

/**
 * Take back the request a released commitment made, if the host is still
 * waiting on it. Somebody who has reviewed since is no longer pending, so their
 * review is never undone, and a board assignment that also names them keeps
 * the request it relies on.
 */
export async function withdrawCommittedReviewer(
  container: AppContainer,
  pullRequest: PullRequestRef,
  reviewer: Reviewer,
): Promise<void> {
  const handle = handleOf(reviewer.handles, pullRequest.provider)
  if (handle === null || (await isAssignedOnBoard(container, pullRequest, reviewer))) return
  const failure = {
    message: 'could not withdraw the released reviewer from the PR',
    fields: { pullRequest: pullRequest.url },
    fallback: undefined,
  }
  await onHost(container, pullRequest, failure, async (vcs) => {
    const pending = await vcs.pendingReviewers(pullRequest)
    const login = pending.find((entry) => isSameHandle(entry, handle))
    if (login !== undefined) await vcs.removeRequestedReviewers(pullRequest, [login])
  })
}

async function isAssignedOnBoard(
  container: AppContainer,
  pullRequest: PullRequestRef,
  reviewer: Reviewer,
): Promise<boolean> {
  const review = await container.repositories.reviews.getByPullRequest(pullRequest)
  return (
    review !== null &&
    review.pullRequest.provider === pullRequest.provider &&
    ACTIVE_REVIEW_STATUSES.includes(review.status) &&
    review.assignedReviewerIds.includes(reviewer.id)
  )
}

/** The named reviewers' handles on the pull request's host, for the mirror. */
export function handlesOf(
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

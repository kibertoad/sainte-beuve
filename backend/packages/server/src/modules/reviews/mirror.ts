import type { Reviewer, ReviewRequest, VcsProvider } from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'

/**
 * Mirror an assignment onto the pull request: the new reviewers requested, and
 * the ones who no longer hold it withdrawn.
 *
 * Best-effort on purpose: GitHub being down must not lose an assignment we
 * have already committed, and the reviewer still gets their Slack nudge. The
 * failure is logged, not swallowed silently. The withdrawal goes first, so the
 * last notification GitHub sends is the one that puts somebody ON the hook.
 */
export async function mirrorAssignment(
  container: AppContainer,
  review: ReviewRequest,
  change: { request: (string | null)[]; withdraw: (string | null)[] },
): Promise<void> {
  const request = known(change.request)
  const withdraw = known(change.withdraw).filter((login) => !request.includes(login))
  if (request.length === 0 && withdraw.length === 0) return
  const vcs = await resolveVcs(container, review.pullRequest.provider)
  if (vcs === null) return
  try {
    if (withdraw.length > 0) {
      await vcs.gateway.removeRequestedReviewers(review.pullRequest, withdraw)
    }
    if (request.length > 0) await vcs.gateway.requestReviewers(review.pullRequest, request)
  } catch (err) {
    container.logger.warn({ err, reviewId: review.id }, 'could not mirror the assignment to the PR')
  }
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

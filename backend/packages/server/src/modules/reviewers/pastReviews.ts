import type { PullRequestRef } from '@sainte-beuve/contracts'
import type { ReviewerTally } from '@sainte-beuve/kernel'
import {
  PAST_REVIEW_READ_LIMIT,
  PAST_REVIEW_STATUSES,
  PAST_REVIEW_WINDOW_MS,
  type ReviewHistory,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'

type Repository = Pick<PullRequestRef, 'provider' | 'owner' | 'repo'>

/**
 * A pull request's repository's recent review history, from the board's rows
 * and the host's own record, for `pastReviewCounts` to credit to reviewers.
 *
 * One read shared by the router and the recommendations, so the reviewer an
 * author is told fits best and the odds an automatic assignment draws with are
 * computed from the same history.
 */
export async function readReviewHistory(
  container: AppContainer,
  pullRequest: Repository,
): Promise<ReviewHistory> {
  const repository = {
    provider: pullRequest.provider,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
  }
  const since = container.clock.now() - PAST_REVIEW_WINDOW_MS
  const [board, host] = await Promise.all([
    container.repositories.reviews.listForRepository(repository, {
      status: PAST_REVIEW_STATUSES,
      since,
      limit: PAST_REVIEW_READ_LIMIT,
    }),
    hostReviewers(container, repository, since),
  ])
  return { board, host }
}

/**
 * The host's tallies, or none. Best-effort like every other host read on this
 * path: a host that is not configured, or is down, leaves the board's count to
 * stand rather than failing an assignment or a recommendation.
 */
async function hostReviewers(
  container: AppContainer,
  repository: Repository,
  since: number,
): Promise<ReviewerTally[]> {
  try {
    const vcs = await resolveVcs(container, repository.provider)
    if (vcs === null) return []
    return await vcs.gateway.pastReviewers(repository, since)
  } catch (err) {
    container.logger.warn(
      { err, provider: repository.provider, owner: repository.owner, repo: repository.repo },
      'could not read the review history from the host',
    )
    return []
  }
}

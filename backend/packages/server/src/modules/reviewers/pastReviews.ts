import type { PullRequestRef } from '@sainte-beuve/contracts'
import {
  PAST_REVIEW_READ_LIMIT,
  PAST_REVIEW_STATUSES,
  PAST_REVIEW_WINDOW_MS,
  type PastReviewCounts,
  countPastReviews,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/**
 * How many reviews each reviewer finished on a pull request's repository,
 * recently, as the board recorded them.
 *
 * One read shared by the router and the recommendations, so the reviewer an
 * author is told fits best and the odds an automatic assignment draws with are
 * computed from the same history.
 */
export async function pastReviewCounts(
  container: AppContainer,
  pullRequest: Pick<PullRequestRef, 'provider' | 'owner' | 'repo'>,
): Promise<PastReviewCounts> {
  const reviews = await container.repositories.reviews.listForRepository(
    { provider: pullRequest.provider, owner: pullRequest.owner, repo: pullRequest.repo },
    {
      status: PAST_REVIEW_STATUSES,
      since: container.clock.now() - PAST_REVIEW_WINDOW_MS,
      limit: PAST_REVIEW_READ_LIMIT,
    },
  )
  return countPastReviews(reviews)
}

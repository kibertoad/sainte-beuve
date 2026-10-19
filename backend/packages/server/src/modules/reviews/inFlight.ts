import type { AiReviewInFlight, AiReviewRun, PullRequestRef } from '@sainte-beuve/contracts'
import { pullRequestKey } from '@sainte-beuve/kernel'
import { isAiReviewInFlight } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/** The most in-flight runs one lookup reads. A tenancy holds far fewer at once. */
const IN_FLIGHT_READ_LIMIT = 500

/**
 * The runs holding each named pull request's place in flight, as admission
 * counts them, oldest first, so a row offers the run that is going rather than
 * a second one admission would refuse. Read from the store, which the clock's
 * sweep keeps current, so a list costs no call to cat-factory.
 */
export async function aiReviewsInFlight(
  container: AppContainer,
  pullRequests: readonly PullRequestRef[],
): Promise<AiReviewInFlight[]> {
  const asked = new Map(
    pullRequests.map((pullRequest) => [pullRequestKey(pullRequest), pullRequest]),
  )
  if (asked.size === 0) return []
  const { aiReviewRuns, reviews } = container.repositories
  const now = container.clock.now()
  const runs = (await aiReviewRuns.listInFlight(IN_FLIGHT_READ_LIMIT)).filter((run) =>
    isAiReviewInFlight(run, now),
  )
  const reviewIds = [...new Set(runs.map((run) => run.reviewId))]
  const found = await Promise.all(reviewIds.map((reviewId) => reviews.getById(reviewId)))
  const pullRequestOf = new Map(
    found.flatMap((review) =>
      review === null ? [] : [[review.id, asked.get(pullRequestKey(review.pullRequest))] as const],
    ),
  )
  return runs
    .flatMap((run) => entryOf(run, pullRequestOf.get(run.reviewId)))
    .sort((left, right) => left.requestedAt - right.requestedAt)
}

function entryOf(run: AiReviewRun, pullRequest: PullRequestRef | undefined): AiReviewInFlight[] {
  if (pullRequest === undefined) return []
  const { reviewId, id: runId, status, requestedAt } = run
  return [{ pullRequest, reviewId, runId, status, requestedAt }]
}

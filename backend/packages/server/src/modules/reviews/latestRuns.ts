import type { AiReviewRun, LatestAiReviewRun, PullRequestRef } from '@sainte-beuve/contracts'
import { pullRequestKey } from '@sainte-beuve/kernel'
import { isAiReviewInFlight } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/**
 * The runs each named pull request's row offers, oldest first: every run
 * holding its place in flight as admission counts them, and the latest one that
 * completed. Read from the store, which the clock's sweep keeps current, so a
 * list costs no call to cat-factory.
 */
export async function latestAiReviewRuns(
  container: AppContainer,
  pullRequests: readonly PullRequestRef[],
): Promise<LatestAiReviewRun[]> {
  if (pullRequests.length === 0) return []
  const { aiReviewRuns, reviews } = container.repositories
  const asked = new Map(
    pullRequests.map((pullRequest) => [pullRequestKey(pullRequest), pullRequest]),
  )
  const found = await reviews.listByPullRequests(pullRequests)
  const pullRequestOf = new Map(
    found.flatMap((review) => {
      const pullRequest = asked.get(pullRequestKey(review.pullRequest))
      return pullRequest === undefined ? [] : [[review.id, pullRequest] as const]
    }),
  )
  const runs = await aiReviewRuns.listByReviews([...pullRequestOf.keys()])
  const now = container.clock.now()
  return [...pullRequestOf]
    .flatMap(([reviewId, pullRequest]) =>
      offered(
        runs.filter((run) => run.reviewId === reviewId),
        now,
      ).map((run) => entryOf(run, pullRequest)),
    )
    .sort((left, right) => left.requestedAt - right.requestedAt)
}

/** One review's runs in flight, plus its latest completed run. */
function offered(runs: readonly AiReviewRun[], now: number): AiReviewRun[] {
  const latestCompleted = runs
    .filter((run) => run.status === 'completed')
    .reduce<AiReviewRun | null>(
      (latest, run) => (latest === null || run.requestedAt > latest.requestedAt ? run : latest),
      null,
    )
  const inFlight = runs.filter((run) => isAiReviewInFlight(run, now))
  return latestCompleted === null ? inFlight : [...inFlight, latestCompleted]
}

function entryOf(run: AiReviewRun, pullRequest: PullRequestRef): LatestAiReviewRun {
  const { reviewId, id: runId, status, requestedAt } = run
  return { pullRequest, reviewId, runId, status, requestedAt }
}

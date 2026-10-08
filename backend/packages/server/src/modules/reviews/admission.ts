import { decideAiReviewAdmission } from '@sainte-beuve/reviewers'
import { ConflictError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'

/**
 * Refuse a run the review may not have yet. The rule is
 * `decideAiReviewAdmission`; this is the read in front of it and the sentence
 * the refusal says.
 *
 * A `ConflictError`, which is the board's own answer about a review's state, so
 * every surface repeats it as it is, including the pull-request comment, which
 * is how somebody typing `@bot ai` twice finds out why the second did nothing.
 */
export async function admitAiReview(container: AppContainer, reviewId: string): Promise<void> {
  const runs = await container.repositories.aiReviewRuns.listByReview(reviewId)
  const decision = decideAiReviewAdmission(runs, container.clock.now())
  if (decision.admitted) return
  if (decision.reason === 'in_flight') {
    throw new ConflictError(
      'An AI review of this pull request is already in flight. Its findings will be on the board.',
    )
  }
  throw new ConflictError(
    'This pull request has had as many AI reviews as it may in an hour. The next one may be ' +
      `requested after ${new Date(decision.retryAt).toISOString()}.`,
  )
}

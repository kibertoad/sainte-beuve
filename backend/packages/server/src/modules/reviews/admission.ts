import type { AiReviewRun } from '@sainte-beuve/contracts'
import { type AiReviewAdmission, decideAiReviewAdmission } from '@sainte-beuve/reviewers'
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
  refuseUnlessAdmitted(decideAiReviewAdmission(runs, container.clock.now()))
}

/**
 * Ask again once the run's own row is written, and give way to any other run
 * the answer now counts.
 *
 * The read in `admitAiReview` and the insert after it are two statements, so two
 * requests arriving together both pass it. Each one re-reads after its own
 * insert and gives way to any other row it finds. For both to go on, each would
 * have to re-read before the other inserted, which neither can, so at most one
 * reaches cat-factory. When both re-read after both inserts, both give way, and
 * the refusal says to ask again. The row that gave way is written
 * off as failed with no task, so it counts toward neither rule.
 */
export async function confirmAiReviewAdmission(
  container: AppContainer,
  run: AiReviewRun,
): Promise<void> {
  const { aiReviewRuns } = container.repositories
  const others = (await aiReviewRuns.listByReview(run.reviewId)).filter(
    (other) => other.id !== run.id,
  )
  const decision = decideAiReviewAdmission(others, container.clock.now())
  if (decision.admitted) return
  await aiReviewRuns.update(run.id, {
    status: 'failed',
    failureReason: RACED,
    completedAt: container.clock.now(),
  })
  throw new ConflictError(
    'Another request for an AI review of this pull request arrived at the same moment. If no ' +
      'run appears on the board, request it again.',
  )
}

const RACED = 'another request for an AI review of this pull request arrived at the same moment'

function refuseUnlessAdmitted(decision: AiReviewAdmission): void {
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

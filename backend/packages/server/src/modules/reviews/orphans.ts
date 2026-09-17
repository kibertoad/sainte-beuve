import type { AiReviewRun } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'

/**
 * The runs cat-factory never acknowledged, and what the clock does about them.
 *
 * Apart from `AiReviewService` because nothing here touches cat-factory: this is
 * a local truth about a local row, and it is the one thing the sweep does that
 * needs no gateway and works on a deployment that has none.
 */

/**
 * How long a run may sit in `requested` with nothing acknowledged before the
 * clock writes it off.
 *
 * Generous on purpose: it only has to outlast the one call that moves a run out
 * of `requested`, and a Worker's whole wall-clock budget is a fraction of it, so
 * nothing merely slow is ever caught by it.
 */
const ORPHANED_REQUEST_AFTER_MS = 5 * 60_000

const REASON =
  'cat-factory never acknowledged this review, so there is nothing to poll: the request did not ' +
  'finish. Request it again'

/**
 * A run cat-factory never acknowledged, written off once it cannot still be
 * being acknowledged.
 *
 * `AiReviewService.request` writes the row BEFORE the call goes out and updates
 * it after, which is what makes a stuck delegation visible instead of silent.
 * The cost is a row that a process dying in between — an evicted isolate, a
 * deploy mid-request — leaves in `requested` with no task id. No poll can ever
 * settle it, because there is no task to ask about, so left alone it is in
 * flight FOR EVER: it holds a place in every batch the clock reads, and it goes
 * on reading, on the board, as a review that is still starting.
 *
 * The grace period is what keeps this off a request that is merely slow, and the
 * re-read is what keeps it off one that landed while the batch was being walked.
 * Even then the worst case self-heals: `request` is the only other writer of
 * this row, and its own update lands after this one and wins.
 */
export async function abandonIfOrphaned(container: AppContainer, run: AiReviewRun): Promise<void> {
  const now = container.clock.now()
  if (now - run.requestedAt < ORPHANED_REQUEST_AFTER_MS) return
  const { aiReviewRuns } = container.repositories
  const current = await aiReviewRuns.getById(run.id)
  if (current === null || current.status !== 'requested' || current.catFactoryTaskId !== null) {
    return
  }
  container.logger.warn(
    { runId: run.id, reviewId: run.reviewId },
    'writing off an AI review run cat-factory never acknowledged',
  )
  await aiReviewRuns.update(run.id, {
    status: 'failed',
    failureReason: REASON,
    completedAt: now,
  })
}

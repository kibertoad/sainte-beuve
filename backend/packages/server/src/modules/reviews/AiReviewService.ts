import type { AiReviewRun } from '@sainte-beuve/contracts'
import { assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'

/**
 * Delegating a review to cat-factory.
 *
 * The run row is written BEFORE the call goes out, in the `requested` state. That
 * ordering is the point: a call that never returns still leaves a trace of what was
 * asked for, so a stuck delegation is visible on the board instead of being a
 * request that silently evaporated.
 */
export class AiReviewService {
  constructor(private readonly container: AppContainer) {}

  async request(reviewId: string, instructions: string | null): Promise<AiReviewRun> {
    const { repositories, clock, ids } = this.container
    const gateway = requireCapability(
      this.container.aiReview,
      'cat-factory is not configured for this deployment',
    )
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const run = await repositories.aiReviewRuns.create({
      id: ids.next(),
      reviewId,
      status: 'requested',
      catFactoryTaskId: null,
      catFactoryUrl: null,
      summary: null,
      failureReason: null,
      requestedAt: clock.now(),
      completedAt: null,
    })

    try {
      const handle = await gateway.requestReview({
        pullRequest: review.pullRequest,
        title: review.title,
        instructions,
      })
      return assertFound(
        await repositories.aiReviewRuns.update(run.id, {
          status: 'running',
          catFactoryTaskId: handle.taskId,
          catFactoryUrl: handle.url,
        }),
        `No AI review run ${run.id}`,
      )
    } catch (err) {
      await repositories.aiReviewRuns.update(run.id, {
        status: 'failed',
        failureReason: getErrorMessage(err),
        completedAt: clock.now(),
      })
      throw err
    }
  }

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    return this.container.repositories.aiReviewRuns.listByReview(reviewId)
  }

  /**
   * Poll one in-flight run and write back what cat-factory reports.
   *
   * Polling rather than a callback because a Worker deployment has no stable
   * inbound URL for cat-factory to call during local development, and a webhook
   * that only works in production is a seam that breaks the day it matters. A
   * cat-factory-side callback is a later addition, not a replacement: see
   * docs/implementation-plan.md, slice 4.
   */
  async refresh(runId: string): Promise<AiReviewRun | null> {
    const { repositories, clock } = this.container
    const gateway = this.container.aiReview
    const run = await repositories.aiReviewRuns.getById(runId)
    if (gateway === null || run === null || run.catFactoryTaskId === null) return run
    if (run.status !== 'running' && run.status !== 'requested') return run

    const reported = await gateway.getStatus(run.catFactoryTaskId)
    const finished = reported.status !== 'running'
    return repositories.aiReviewRuns.update(runId, {
      status: reported.status,
      summary: reported.summary,
      failureReason: reported.failureReason,
      completedAt: finished ? clock.now() : null,
    })
  }
}

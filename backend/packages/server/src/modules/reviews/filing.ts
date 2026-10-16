import type { AiReviewRun, ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { catFactoryPlacementKeys } from '../projects/directoryKeys.js'
import { RepositorySyncService } from '../projects/RepositorySyncService.js'

/**
 * Follow cat-factory's directory now, after filing for a repository no
 * workspace linked: filing links it, and this registers it here without waiting
 * for the clock. Best effort, since the clock gets there anyway.
 */
async function adoptLinked(container: AppContainer): Promise<void> {
  try {
    await new RepositorySyncService(container).catchUpNow()
  } catch (err) {
    container.logger.warn(
      { reason: getErrorMessage(err) },
      'the repository directory could not be followed after filing a review',
    )
  }
}

/**
 * Hand a review to cat-factory for a run row already written in `requested`,
 * and record where it landed: the task, its link, and the workspace every
 * later call about it has to name. A refusal fails the row with its reason and
 * is rethrown, so the caller answers it and the board shows it.
 */
export async function fileWithCatFactory(
  container: AppContainer,
  gateway: AiReviewGateway,
  run: AiReviewRun,
  input: { review: ReviewRequest; instructions: string | null },
): Promise<AiReviewRun> {
  const { repositories, clock } = container
  const { review, instructions } = input
  try {
    const keys = await catFactoryPlacementKeys(container, review.pullRequest)
    const handle = await gateway.requestReview({
      pullRequest: review.pullRequest,
      title: review.title,
      instructions,
      ...keys,
    })
    if (keys.directoryKeys.length === 0) await adoptLinked(container)
    return assertFound(
      await repositories.aiReviewRuns.update(run.id, {
        status: 'running',
        catFactoryTaskId: handle.taskId,
        catFactoryUrl: handle.url,
        catFactoryWorkspaceId: handle.workspaceId,
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

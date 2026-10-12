import type { AiReviewRun, ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { catFactoryDirectoryKeys } from '../projects/directoryKeys.js'

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
    const handle = await gateway.requestReview({
      pullRequest: review.pullRequest,
      title: review.title,
      instructions,
      directoryKeys: await catFactoryDirectoryKeys(container, review.pullRequest),
    })
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

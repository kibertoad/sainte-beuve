import type { AiReviewRun, PullRequestRef, ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { CAT_FACTORY_SOURCE } from '../projects/RepositorySyncService.js'

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
      directoryKeys: await directoryKeysFor(container, review.pullRequest),
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

/**
 * The keys cat-factory's directory lists a pull request's repository under, one
 * per workspace that links it, read from this org's mirror of the directory.
 *
 * Matched on the provider, then on the host's repository id when the project
 * came from the directory, because that survives a rename the mirror has not
 * caught up with; otherwise on the owner and name. An org that has not
 * connected cat-factory holds no mirror and gets no keys. Sorted, because the
 * stores list in no set order and the gateway files in the first workspace
 * that backs the repository, so the same repository lands in the same one.
 */
async function directoryKeysFor(
  container: AppContainer,
  pullRequest: PullRequestRef,
): Promise<string[]> {
  const { projects, externalRepositories } = container.repositories
  const [project, entries] = await Promise.all([
    projects.getByRef(pullRequest),
    externalRepositories.list(CAT_FACTORY_SOURCE),
  ])
  const externalId = project?.external?.source === CAT_FACTORY_SOURCE ? project.external.id : null
  return entries
    .filter(({ repository }) => {
      if (repository === null || repository.provider !== pullRequest.provider) return false
      if (externalId !== null) return repository.id === externalId
      return (
        sameName(repository.owner, pullRequest.owner) && sameName(repository.repo, pullRequest.repo)
      )
    })
    .map((entry) => entry.key)
    .sort()
}

/** GitHub and GitLab both treat owner and repository names case-insensitively. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

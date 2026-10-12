import type { Project, PullRequestRef, ReviewRequest } from '@sainte-beuve/contracts'
import { type MatchTarget, matchTargetFor } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/** What the deployment knows about a pull request before anybody is matched to it. */
export interface PullRequestContext {
  project: Project | null
  /** Its board row, when the board tracks it. */
  review: ReviewRequest | null
}

export async function loadPullRequestContext(
  container: AppContainer,
  pullRequest: PullRequestRef,
): Promise<PullRequestContext> {
  const { repositories } = container
  const [project, boardRow] = await Promise.all([
    repositories.projects.getByRef(pullRequest),
    repositories.reviews.getByPullRequest(pullRequest),
  ])
  // The board looks a row up by owner, repo and number alone, so a row from
  // the other host under the same names is not this pull request.
  const review = boardRow?.pullRequest.provider === pullRequest.provider ? boardRow : null
  return { project, review }
}

/**
 * What a pull request wants from a reviewer: the skills somebody picked, else
 * the ones its board row wants, else its repository's, and the repository's
 * domains. The recommendations rank against this and an ask is matched
 * against it, so the list an author picks from and the people a broadcast
 * reaches are measured the same way.
 */
export function wantedFor(
  requestedSkills: readonly string[],
  context: PullRequestContext,
): MatchTarget {
  const skills =
    requestedSkills.length > 0 ? requestedSkills : (context.review?.requiredSkills ?? [])
  return matchTargetFor({ requiredSkills: skills }, context.project)
}

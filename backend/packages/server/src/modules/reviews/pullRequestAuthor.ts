import type { PullRequestRef } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'

/** What a board row records for an author nobody could name. */
const UNKNOWN_AUTHOR = 'unknown'

/**
 * The author as the host reports it, for a row about to be opened without one.
 * The router keeps a review away from its own author, which only works with a
 * real login, so this is worth one read. A host that cannot be reached does not
 * block the review: the row records an unknown author and the failure is logged.
 */
export async function readPullRequestAuthor(
  container: AppContainer,
  pullRequest: PullRequestRef,
): Promise<string> {
  const vcs = await resolveVcs(container, pullRequest.provider)
  if (vcs === null) return UNKNOWN_AUTHOR
  const { provider, owner, repo, number } = pullRequest
  try {
    return (await vcs.gateway.pullRequestStatus({ provider, owner, repo, number })).authorLogin
  } catch (err) {
    container.logger.warn(
      { err, owner, repo, number },
      'could not read the author of a pull request',
    )
    return UNKNOWN_AUTHOR
  }
}

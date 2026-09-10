import type { OpenPullRequest } from '@sainte-beuve/contracts'
import { isSameHandle } from './selection.js'

/**
 * Which of a host's open pull requests belong on which of the viewer's lists.
 *
 * Pure, and separate from the fetch, for the reason the workspace exists: a
 * person is known by a different handle on each host, so "mine" is a question
 * about a SET of handles rather than about a string, and getting that wrong
 * shows somebody an empty workspace with no way to tell whether it is empty
 * because there is no work or because it looked for the wrong name.
 */

export interface PartitionedPullRequests {
  authored: OpenPullRequest[]
  reviewRequested: OpenPullRequest[]
}

/**
 * Split by the part the viewer plays.
 *
 * The two lists are EXCLUSIVE: a pull request you opened stays in `authored`
 * even if the host also has a review request against you on it, which happens
 * when somebody reassigns their own work. Listing it twice would make the
 * workspace count the same job as two.
 *
 * Ordered newest-updated first, because a workspace is read top down and the
 * thing that moved last is the thing with a comment on it.
 */
export function partitionForViewer(
  pullRequests: readonly OpenPullRequest[],
  handles: readonly string[],
): PartitionedPullRequests {
  const mine = (login: string): boolean => handles.some((handle) => isSameHandle(handle, login))
  const authored: OpenPullRequest[] = []
  const reviewRequested: OpenPullRequest[] = []
  for (const pr of pullRequests) {
    if (mine(pr.authorLogin)) authored.push(pr)
    else if (pr.requestedReviewerLogins.some(mine)) reviewRequested.push(pr)
  }
  return { authored: byRecency(authored), reviewRequested: byRecency(reviewRequested) }
}

function byRecency(pullRequests: OpenPullRequest[]): OpenPullRequest[] {
  return pullRequests.sort((a, b) => b.updatedAt - a.updatedAt)
}

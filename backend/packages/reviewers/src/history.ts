import type { Reviewer, ReviewRequest, VcsProvider } from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import { countPastReviews } from './familiarity.js'
import { isSameHandle } from './selection.js'

/**
 * Where a repository's review history comes from: the board, which knows its
 * own rows by reviewer id, and the host, which knows every verdict by handle.
 * Most reviews never touch the board, so the host is the fuller source; the
 * board still counts when the host is not configured or does not answer.
 */

/** How many of a repository's pull requests one handle gave a verdict on, as the host tallies it. */
export interface HostReviewTally {
  login: string
  reviews: number
}

export interface ReviewHistory {
  /** The board's reviews in the repository; only the finished ones are counted. */
  board: readonly Pick<ReviewRequest, 'status' | 'assignedReviewerIds'>[]
  /** The host's tallies, empty when it was not asked or did not answer. */
  host: readonly HostReviewTally[]
}

/**
 * Reviews each candidate finished in the repository, by reviewer id.
 *
 * The two sources describe one history, not two: a review assigned on the board
 * is answered on the host, so a sum would count it twice. Each reviewer gets the
 * larger of the two counts instead. The board's can be the larger one when its
 * window reaches further back than the host's page, or when a verdict was set
 * on the board without a review on the host.
 */
export function pastReviewCounts(
  history: ReviewHistory,
  candidates: readonly Reviewer[],
  provider: VcsProvider,
): Map<string, number> {
  const counts = countPastReviews(history.board)
  for (const reviewer of candidates) {
    const handle = handleOf(reviewer.handles, provider)
    const onHost = history.host
      .filter((tally) => isSameHandle(handle, tally.login))
      .reduce((sum, tally) => sum + tally.reviews, 0)
    if (onHost > (counts.get(reviewer.id) ?? 0)) counts.set(reviewer.id, onHost)
  }
  return counts
}

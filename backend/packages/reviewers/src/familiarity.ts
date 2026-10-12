import type { ReviewRequest, ReviewStatus } from '@sainte-beuve/contracts'

/**
 * Familiarity: how many reviews somebody has already finished on the repository
 * a pull request lives in, and how much that raises their share of the draw.
 *
 * Somebody who has reviewed a repository before reads its next change faster and
 * knows where it breaks, so they are preferred. The preference is bounded and
 * diminishing on purpose: a straight count would hand every review in a
 * repository to whoever reviewed it most, which concentrates the knowledge the
 * bonus is meant to reward instead of spreading it.
 */

/** Reviewer id to the number of reviews they finished on one repository. Absent means none. */
export type PastReviewCounts = ReadonlyMap<string, number>

/** No history at all, for a caller with no repository to ask about. */
export const NO_PAST_REVIEWS: PastReviewCounts = new Map()

/**
 * The most familiarity can add to a reviewer's multiplier, approached and never
 * reached. Half of `MATCH_PREFERENCE`, so holding the whole wanted mix still
 * counts for more than any history: a stranger to a repository who knows its
 * stack is a better pick than a regular who does not.
 */
export const PAST_REVIEW_PREFERENCE = 2

/**
 * The number of past reviews that earns half of `PAST_REVIEW_PREFERENCE`. One
 * review earns a quarter of the bonus, three earn half, nine earn three quarters.
 */
export const PAST_REVIEW_HALF_POINT = 3

/**
 * The verdicts that count as a review somebody finished. `closed` is left out:
 * a pull request closed unreviewed says nothing about who read it.
 */
export const PAST_REVIEW_STATUSES: readonly ReviewStatus[] = ['approved', 'changes_requested']

/**
 * How far back a past review still counts, measured from when its pull request
 * was tracked rather than when the verdict landed. People move on, and so does a
 * codebase.
 */
export const PAST_REVIEW_WINDOW_MS = 180 * 24 * 60 * 60 * 1000

/** The most finished reviews one repository's history read decodes. */
export const PAST_REVIEW_READ_LIMIT = 200

/** The multiplier term familiarity adds: zero for none, rising towards the preference. */
export function familiarityBonus(pastReviews: number): number {
  if (pastReviews <= 0) return 0
  return (PAST_REVIEW_PREFERENCE * pastReviews) / (pastReviews + PAST_REVIEW_HALF_POINT)
}

/**
 * Count the finished reviews per reviewer. Each review counts once for everyone
 * assigned to it when it settled, whatever order the rows arrive in.
 */
export function countPastReviews(
  reviews: readonly Pick<ReviewRequest, 'status' | 'assignedReviewerIds'>[],
): Map<string, number> {
  const counted = new Set(PAST_REVIEW_STATUSES)
  const counts = new Map<string, number>()
  for (const review of reviews) {
    if (!counted.has(review.status)) continue
    for (const reviewerId of new Set(review.assignedReviewerIds)) {
      counts.set(reviewerId, (counts.get(reviewerId) ?? 0) + 1)
    }
  }
  return counts
}

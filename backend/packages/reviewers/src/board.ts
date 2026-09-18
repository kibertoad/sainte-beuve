import type {
  AssignedReviewer,
  BoardReview,
  ReviewPriority,
  Reviewer,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'

/**
 * What the board is, as a function of what the store holds.
 *
 * Two decisions live here, and both were previously nowhere. The first is WHO:
 * a review carries reviewer ids, and a screen whose purpose is "what has this
 * deployment taken responsibility for" cannot answer it with `rev-…`-shaped
 * strings, so the names are joined on from the directory. The second is ORDER: a
 * store answers newest-first, which is the order rows were created in and has
 * nothing to do with which of them somebody should open next.
 *
 * Pure, so the order is a suite rather than a thing you check by opening the
 * screen and squinting, and so the Slack `list` command can read the same
 * definition the board does rather than inventing a second one.
 */

/** The statuses a review has stopped in. Its row is history, not a queue entry. */
const SETTLED: ReadonlySet<ReviewStatus> = new Set<ReviewStatus>([
  'approved',
  'changes_requested',
  'closed',
])

/** Ascending, so a lower number sorts first. `high` is what somebody opens next. */
const PRIORITY_RANK: Record<ReviewPriority, number> = { high: 0, normal: 1, low: 2 }

export function isSettledReview(status: ReviewStatus): boolean {
  return SETTLED.has(status)
}

/** Past its soft deadline, which is the one fact that outranks priority. */
export function isOverdue(review: Pick<ReviewRequest, 'dueAt'>, now: number): boolean {
  return review.dueAt !== null && review.dueAt <= now
}

/**
 * The board: every review with the people on it named, most urgent first.
 *
 * `now` is a parameter rather than a clock read, like every other decision in
 * this package: "overdue" is a comparison against a moment, and a function that
 * read the moment itself could not be tested for the minute either side of it.
 */
export function buildBoard(
  reviews: readonly ReviewRequest[],
  reviewers: readonly Reviewer[],
  now: number,
): BoardReview[] {
  const byId = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]))
  return reviews
    .map((review) => ({ ...review, assignedReviewers: nameAssignees(review, byId) }))
    .sort((a, b) => compareUrgency(a, b, now))
}

/**
 * The ids resolved to names, in assignment order.
 *
 * An id with no reviewer row is DROPPED rather than rendered as itself: a person
 * removed from the directory leaves their id on every review they were on, and a
 * row reading "assigned to rev-7f3a" tells nobody anything they can act on. The
 * count can therefore be shorter than `assignedReviewerIds`, which is the honest
 * answer — the review is still assigned, to somebody this deployment no longer
 * knows.
 */
function nameAssignees(
  review: ReviewRequest,
  byId: ReadonlyMap<string, Reviewer>,
): AssignedReviewer[] {
  const named: AssignedReviewer[] = []
  for (const reviewerId of review.assignedReviewerIds) {
    const reviewer = byId.get(reviewerId)
    if (reviewer !== undefined) named.push({ reviewerId, displayName: reviewer.displayName })
  }
  return named
}

/**
 * Which of two reviews somebody should look at first.
 *
 * Settled rows go last whatever else is true of them: they are only on the
 * screen at all because somebody asked to see history, and history above a
 * queue is a board that buries its own work.
 */
function compareUrgency(a: ReviewRequest, b: ReviewRequest, now: number): number {
  const settled = Number(isSettledReview(a.status)) - Number(isSettledReview(b.status))
  if (settled !== 0) return settled
  // Among settled rows the interesting one is the one that just settled, so they
  // read newest-first — the opposite of the queue below, and for the opposite
  // reason.
  if (isSettledReview(a.status)) return b.updatedAt - a.updatedAt || tieBreak(a, b)
  return compareWaiting(a, b, now)
}

/** Overdue, then priority, then how long it has sat. */
function compareWaiting(a: ReviewRequest, b: ReviewRequest, now: number): number {
  const overdue = Number(isOverdue(b, now)) - Number(isOverdue(a, now))
  if (overdue !== 0) return overdue
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (priority !== 0) return priority
  // OLDEST first: the point of the board is the thing nobody has picked up, and
  // the longer it has been ignored the more it needs to be at the top.
  return a.createdAt - b.createdAt || tieBreak(a, b)
}

/** So the order is TOTAL: two rows created in one millisecond must not swap between reads. */
function tieBreak(a: ReviewRequest, b: ReviewRequest): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

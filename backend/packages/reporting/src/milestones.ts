import type { ReviewMilestone } from '@sainte-beuve/contracts'
import type { EpochMs, PullRequestTimeline, ReviewEvent } from '@sainte-beuve/kernel'
import { isAutomatedReviewer } from './automation.js'

/**
 * Where one pull request stands on one milestone. `excluded` is a pull request
 * that closed without reaching it: it neither took that long nor is waiting.
 */
export type MilestoneOutcome =
  | { state: 'reached'; afterMs: number }
  | { state: 'waiting'; forMs: number }
  | { state: 'excluded' }

export type MilestoneOutcomes = Record<ReviewMilestone, MilestoneOutcome>

/** Whether a pull request is timed at all: one still in draft has not asked for a review. */
export function isTimed(pr: PullRequestTimeline): boolean {
  return !pr.draft
}

/**
 * Each milestone of one pull request, measured from when it was ready for
 * review. A review given while it was still a draft counts as immediate rather
 * than negative. The author's own reviews (a reply on their own pull request is
 * a COMMENTED review on GitHub) are not reviews of it.
 */
export function milestonesOf(pr: PullRequestTimeline, now: EpochMs): MilestoneOutcomes {
  const reviews = reviewsByOthers(pr)
  const human = humanReviews(reviews)
  const approvals = reviews.filter((review) => review.kind === 'approved')
  return {
    first_review: outcome(pr, earliestReview(reviews)?.at ?? null, now),
    first_human_review: outcome(pr, earliestReview(human)?.at ?? null, now),
    approval: outcome(pr, earliestReview(approvals)?.at ?? null, now),
    merge: outcome(pr, pr.mergedAt, now),
  }
}

/** The reviews of a pull request by anybody but its author. */
export function reviewsByOthers(pr: PullRequestTimeline): ReviewEvent[] {
  return pr.reviews.filter((review) => !isAuthor(pr, review.login))
}

/** The ones a person gave, bots and AI reviewers left out. */
export function humanReviews(reviews: readonly ReviewEvent[]): ReviewEvent[] {
  return reviews.filter((review) => !isAutomatedReviewer(review.login, review.bot))
}

function outcome(pr: PullRequestTimeline, at: EpochMs | null, now: EpochMs): MilestoneOutcome {
  if (at !== null) return { state: 'reached', afterMs: Math.max(0, at - pr.readyAt) }
  if (pr.closedAt !== null) return { state: 'excluded' }
  return { state: 'waiting', forMs: Math.max(0, now - pr.readyAt) }
}

/** The first of some reviews, or null when there are none. */
export function earliestReview(reviews: readonly ReviewEvent[]): ReviewEvent | null {
  return reviews.reduce<ReviewEvent | null>(
    (first, review) => (first === null || review.at < first.at ? review : first),
    null,
  )
}

function isAuthor(pr: PullRequestTimeline, login: string): boolean {
  return pr.authorLogin !== null && pr.authorLogin.toLowerCase() === login.toLowerCase()
}

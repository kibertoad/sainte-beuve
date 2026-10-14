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
  const reviews = pr.reviews.filter((review) => !isAuthor(pr, review.login))
  const human = reviews.filter((review) => !isAutomatedReviewer(review.login, review.bot))
  const approvals = reviews.filter((review) => review.kind === 'approved')
  return {
    first_review: outcome(pr, earliest(reviews), now),
    first_human_review: outcome(pr, earliest(human), now),
    approval: outcome(pr, earliest(approvals), now),
    merge: outcome(pr, pr.mergedAt, now),
  }
}

function outcome(pr: PullRequestTimeline, at: EpochMs | null, now: EpochMs): MilestoneOutcome {
  if (at !== null) return { state: 'reached', afterMs: Math.max(0, at - pr.readyAt) }
  if (pr.closedAt !== null) return { state: 'excluded' }
  return { state: 'waiting', forMs: Math.max(0, now - pr.readyAt) }
}

function earliest(reviews: readonly ReviewEvent[]): EpochMs | null {
  return reviews.reduce<EpochMs | null>(
    (first, review) => (first === null || review.at < first ? review.at : first),
    null,
  )
}

function isAuthor(pr: PullRequestTimeline, login: string): boolean {
  return pr.authorLogin !== null && pr.authorLogin.toLowerCase() === login.toLowerCase()
}

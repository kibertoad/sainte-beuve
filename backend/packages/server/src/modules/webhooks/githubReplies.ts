import type {
  AiReviewRun,
  AssignReviewersResult,
  Reviewer,
  ReviewRequest,
  ShortfallReason,
} from '@sainte-beuve/contracts'
import { shortfallCause, shortfallRemedy } from '@sainte-beuve/contracts'

// ---------------------------------------------------------------------------
// What the bot says on a pull request. Pure text, so the wording is testable and
// so the service stays about ordering and writes.
//
// The rule behind every line: name who is on the hook, or name what is missing.
// A bot comment that says "done" is a comment somebody has to leave the pull
// request to act on.
// ---------------------------------------------------------------------------

/**
 * A shortfall line: the cause, the tail this channel owns, then the advice where
 * there is any to give.
 *
 * The cause and the advice come from `@sainte-beuve/contracts`, which is also where
 * the board reads them, so a person reading this comment and a person reading the
 * screen are told the same thing by construction rather than by a promise.
 */
function shortfallLine(reason: ShortfallReason | null, tail: string): string {
  if (reason === null) return `Nobody was assigned, ${tail}`
  const sentence = `${shortfallCause(reason)}, ${tail}`
  const remedy = shortfallRemedy(reason)
  return remedy === null ? sentence : `${sentence} ${remedy}`
}

export const botReply = {
  assigned(result: AssignReviewersResult): string {
    if (result.assigned.length > 0) {
      const names = result.assigned.map((reviewer) => reviewer.displayName).join(', ')
      return `Review requested from ${names}.`
    }
    return shortfallLine(result.shortfallReason, 'so it is on the board unassigned.')
  },

  /**
   * A reroll, which has a second outcome an assign does not: nobody else could
   * take it. The review then STAYS with whoever has it, so the tail says that
   * rather than reporting an unassigned board.
   */
  rerolled(result: AssignReviewersResult): string {
    if (result.assigned.length > 0) {
      const names = result.assigned.map((reviewer) => reviewer.displayName).join(', ')
      return `Handed over to ${names}, and taken off whoever had it.`
    }
    return shortfallLine(result.shortfallReason, 'so it stays with whoever has it.')
  },

  aiRequested(run: AiReviewRun): string {
    const link = run.catFactoryUrl === null ? '' : ` Follow it at ${run.catFactoryUrl}.`
    return `Handed this to cat-factory (run \`${run.id}\`, ${run.status}).${link}`
  },

  status(review: ReviewRequest, reviewers: (Reviewer | null)[]): string {
    const named = reviewers
      .map((reviewer) => reviewer?.displayName)
      .filter((name): name is string => name !== undefined)
    const who = named.length === 0 ? 'nobody yet' : named.join(', ')
    const skills =
      review.requiredSkills.length === 0 ? 'any reviewer' : review.requiredSkills.join(', ')
    return `Status **${review.status}**, with ${who} on it. Needs: ${skills}.`
  },

  untracked(): string {
    return (
      'This pull request is not on the review board yet. Mention me again with `review` to ' +
      'put it there and find a reviewer.'
    )
  },

  failed(reason: string): string {
    return `I could not do that: ${reason}`
  },
}

import type {
  AiReviewRun,
  AssignReviewersResult,
  Reviewer,
  ReviewRequest,
} from '@sainte-beuve/contracts'

/**
 * What the bot says on a pull request. Pure text, so the wording is testable and
 * so the service stays about ordering and writes.
 *
 * The rule behind every line: name who is on the hook, or name what is missing.
 * A bot comment that says "done" is a comment somebody has to leave the pull
 * request to act on.
 */
export const botReply = {
  assigned(result: AssignReviewersResult): string {
    if (result.assigned.length > 0) {
      const names = result.assigned.map((reviewer) => reviewer.displayName).join(', ')
      return `Review requested from ${names}.`
    }
    return result.shortfallReason === 'no_candidates'
      ? 'Nobody in the reviewer pool holds every skill this review needs, so it is on the board ' +
          'unassigned. Add the skill to a reviewer, or drop it from the request.'
      : 'Everybody who could review this is already on it or is the author, so it is on the ' +
          'board unassigned.'
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

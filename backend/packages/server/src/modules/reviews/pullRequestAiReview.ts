import type { AiReviewRun, RequestPullRequestAiReview } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveAiReview } from '../../integrations/resolve.js'
import { AiReviewService, NOT_CONFIGURED } from './AiReviewService.js'
import { ReviewService } from './ReviewService.js'

/**
 * File an AI review on a pull request that may not be on the board yet.
 *
 * The capability is checked before the row is tracked, so an org without
 * cat-factory does not gain a board row, a reminder ladder and a Slack
 * announcement for a review that was never filed. Past that, a refusal
 * (the rate limit, cat-factory saying no) leaves the row tracked, the way the
 * AI-review label does: the pull request is a real review either way.
 */
export async function requestPullRequestAiReview(
  container: AppContainer,
  input: RequestPullRequestAiReview,
): Promise<AiReviewRun> {
  requireCapability(await resolveAiReview(container), NOT_CONFIGURED)
  const { review } = await new ReviewService(container).track({
    pullRequest: input.pullRequest,
    title: input.title,
    // What the AI-review label records for an author it was not told about.
    authorLogin: input.authorLogin ?? 'unknown',
    requiredSkills: [],
    priority: 'normal',
    dueAt: null,
  })
  return new AiReviewService(container).request(review.id, input.instructions)
}

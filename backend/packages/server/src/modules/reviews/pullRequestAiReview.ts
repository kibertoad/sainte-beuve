import type {
  AiReviewRun,
  RequestPullRequestAiReview,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveActingAiReview } from '../../integrations/catFactoryPersonal.js'
import { AiReviewService, NOT_CONFIGURED } from './AiReviewService.js'
import { readPullRequestAuthor } from './pullRequestAuthor.js'
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
  const filing = requireCapability(await resolveActingAiReview(container), NOT_CONFIGURED)
  const review = await boardRowFor(container, input)
  return new AiReviewService(container).request(review.id, input.instructions, filing)
}

/** The pull request's board row, opened with its author when it has none yet. */
async function boardRowFor(
  container: AppContainer,
  input: RequestPullRequestAiReview,
): Promise<ReviewRequest> {
  const existing = await container.repositories.reviews.getByPullRequest(input.pullRequest)
  if (existing !== null) return existing
  const { review } = await new ReviewService(container).track({
    pullRequest: input.pullRequest,
    title: input.title,
    authorLogin: input.authorLogin ?? (await readPullRequestAuthor(container, input.pullRequest)),
    requiredSkills: [],
    priority: 'normal',
    dueAt: null,
  })
  return review
}

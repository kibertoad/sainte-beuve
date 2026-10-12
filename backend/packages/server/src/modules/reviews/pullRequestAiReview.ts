import type {
  AiReviewRun,
  PullRequestRef,
  RequestPullRequestAiReview,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveAiReview, resolveVcs } from '../../integrations/resolve.js'
import { AiReviewService, NOT_CONFIGURED } from './AiReviewService.js'
import { ReviewService } from './ReviewService.js'

/** What a board row records for an author nobody could name, as the AI-review label does. */
const UNKNOWN_AUTHOR = 'unknown'

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
  const filing = requireCapability(await resolveAiReview(container), NOT_CONFIGURED)
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
    authorLogin: input.authorLogin ?? (await readAuthor(container, input.pullRequest)),
    requiredSkills: [],
    priority: 'normal',
    dueAt: null,
  })
  return review
}

/**
 * The author as the host reports it, for a row that did not know it (a
 * commitment). The router keeps a review away from its own author, which only
 * works with a real login, so this is worth one read. A host that cannot be
 * reached does not block the review: the row records an unknown author, as the
 * label path does, and the failure is logged.
 */
async function readAuthor(container: AppContainer, pullRequest: PullRequestRef): Promise<string> {
  const vcs = await resolveVcs(container, pullRequest.provider)
  if (vcs === null) return UNKNOWN_AUTHOR
  const { provider, owner, repo, number } = pullRequest
  try {
    return (await vcs.gateway.pullRequestStatus({ provider, owner, repo, number })).authorLogin
  } catch (err) {
    container.logger.warn(
      { err, owner, repo, number },
      'could not read the author of a pull request filed for an AI review',
    )
    return UNKNOWN_AUTHOR
  }
}

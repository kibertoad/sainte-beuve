import type { PullRequestRef, ReviewRequest } from '@sainte-beuve/contracts'
import { ForbiddenError, formatPullRequest, getErrorMessage } from '@sainte-beuve/kernel'
import type { GitHubDelivery, GitHubIntent } from '@sainte-beuve/integrations'
import { interpretGitHubDelivery, verifyGitHubSignature } from '@sainte-beuve/integrations'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveVcs } from '../../integrations/resolve.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { ReviewService } from '../reviews/ReviewService.js'
import { botReply } from './githubReplies.js'

/**
 * Inbound GitHub deliveries, from the signature to the write.
 *
 * The order is the security property: the signature is checked over the RAW
 * bytes before anything is parsed, because that is what GitHub signed, and
 * because a payload that has been through `JSON.parse` has already been trusted.
 *
 * Deliveries are handled INLINE rather than queued. GitHub's own guidance is to
 * ack fast and work asynchronously, and it earns its keep when the work is a
 * repository backfill; here the work is one or two writes against a store the
 * request already holds, so a queue would add a binding, a consumer and a second
 * failure mode to save a few milliseconds. If a handler ever grows to where that
 * stops being true, the seam to add is behind this method.
 */

const NO_SECRET =
  'This deployment cannot verify GitHub deliveries: set GITHUB_WEBHOOK_SECRET to the secret ' +
  'configured on the GitHub App or repository webhook'

/** What the delivery caused, for the ack body and the log line. */
export interface GitHubWebhookOutcome {
  /** The intent that was performed, or `ignored` for a delivery that asked for nothing. */
  action: string
  reviewId: string | null
}

const IGNORED: GitHubWebhookOutcome = { action: 'ignored', reviewId: null }

export class GitHubWebhookService {
  constructor(private readonly container: AppContainer) {}

  async handle(input: {
    event: string
    rawBody: string
    signature: string | null
  }): Promise<GitHubWebhookOutcome> {
    const secret = requireCapability(this.container.github.webhookSecret, NO_SECRET)
    if (!(await verifyGitHubSignature(secret, input.rawBody, input.signature))) {
      // Forbidden rather than unauthorized: nothing about this request is going to
      // be retried with better credentials, and the body is a stranger's.
      throw new ForbiddenError('The GitHub delivery signature did not match')
    }
    const delivery = this.parse(input.event, input.rawBody)
    if (delivery === null) return IGNORED
    const intent = interpretGitHubDelivery(delivery, {
      labels: this.container.github.labels,
      botLogin: this.container.github.botLogin,
    })
    return intent === null ? IGNORED : this.perform(intent)
  }

  private parse(event: string, rawBody: string): GitHubDelivery | null {
    try {
      return { event, payload: JSON.parse(rawBody) as GitHubDelivery['payload'] }
    } catch {
      // A body that passed the signature check and is not JSON cannot happen
      // through GitHub. Logged rather than thrown, because answering 400 to a
      // verified delivery makes GitHub retry it forever.
      this.container.logger.warn({ event }, 'a verified GitHub delivery was not JSON')
      return null
    }
  }

  private async perform(intent: GitHubIntent): Promise<GitHubWebhookOutcome> {
    if (intent.kind === 'track') return this.track(intent)
    if (intent.kind === 'ai_review') return this.delegate(intent.pullRequest)
    if (intent.kind === 'command') return this.command(intent)
    const status = intent.kind === 'close' ? 'closed' : intent.status
    // An event about a pull request nobody tracked is not a fault: a repository
    // has open pull requests that predate the App, and closing one of those is
    // simply not our business.
    const review = await this.tracked(intent.pullRequest)
    if (review === null) return IGNORED
    await new ReviewService(this.container).updateStatus(review.id, status)
    return { action: status, reviewId: review.id }
  }

  private async track(
    intent: Extract<GitHubIntent, { kind: 'track' }>,
  ): Promise<GitHubWebhookOutcome> {
    const service = new ReviewService(this.container)
    const { review, created } = await service.track(intent.review)
    if (!intent.route || review.assignedReviewerIds.length > 0) {
      return { action: created ? 'tracked' : 'already_tracked', reviewId: review.id }
    }
    const result = await service.assign(review.id, { count: 1, excludeReviewerIds: [] })
    return {
      action: result.assigned.length > 0 ? 'assigned' : 'no_reviewer_available',
      reviewId: review.id,
    }
  }

  /**
   * The AI-review label, on a pull request we may never have seen. Tracked first,
   * because a run belongs to a review request: labelling an untracked pull request
   * is a perfectly sensible way to ask for an AI review, and refusing it because
   * nobody registered the PR first would be an implementation detail leaking into
   * a team's workflow.
   */
  private async delegate(pullRequest: PullRequestRef): Promise<GitHubWebhookOutcome> {
    const { review } = await new ReviewService(this.container).track({
      pullRequest,
      title: formatPullRequest(pullRequest),
      authorLogin: 'unknown',
      requiredSkills: [],
      priority: 'normal',
      dueAt: null,
    })
    const run = await new AiReviewService(this.container).request(review.id, null)
    return { action: `ai_review:${run.status}`, reviewId: review.id }
  }

  /**
   * A comment that @-mentioned the bot. The bot ALWAYS answers, including when it
   * refuses: a mention that produces silence is indistinguishable from a webhook
   * that never arrived, and the person who typed it has no other way to tell.
   */
  private async command(
    intent: Extract<GitHubIntent, { kind: 'command' }>,
  ): Promise<GitHubWebhookOutcome> {
    const outcome = await this.runCommand(intent)
    await this.reply(intent.pullRequest, outcome.body)
    return { action: `command:${intent.verb}`, reviewId: outcome.reviewId }
  }

  private async runCommand(
    intent: Extract<GitHubIntent, { kind: 'command' }>,
  ): Promise<{ body: string; reviewId: string | null }> {
    const reviews = new ReviewService(this.container)
    try {
      if (intent.verb === 'status') return this.status(intent.pullRequest)
      const { review } = await reviews.track(this.blankReview(intent.pullRequest, intent.requester))
      if (intent.verb === 'ai') {
        const run = await new AiReviewService(this.container).request(review.id, null)
        return { body: botReply.aiRequested(run), reviewId: review.id }
      }
      const exclude = intent.verb === 'reroll' ? review.assignedReviewerIds : []
      const result = await reviews.assign(review.id, { count: 1, excludeReviewerIds: exclude })
      return { body: botReply.assigned(result), reviewId: review.id }
    } catch (err) {
      // The refusal is the answer. A 503 for an unconfigured cat-factory and a
      // 404 for a reviewer somebody deleted both carry a message written for an
      // operator, and the pull request is where the person who asked is looking.
      return { body: botReply.failed(getErrorMessage(err)), reviewId: null }
    }
  }

  private async status(pullRequest: PullRequestRef): Promise<{
    body: string
    reviewId: string | null
  }> {
    const review = await this.tracked(pullRequest)
    if (review === null) return { body: botReply.untracked(), reviewId: null }
    const reviewers = await Promise.all(
      review.assignedReviewerIds.map((id) => this.container.repositories.reviewers.getById(id)),
    )
    return { body: botReply.status(review, reviewers), reviewId: review.id }
  }

  private blankReview(pullRequest: PullRequestRef, authorLogin: string) {
    return {
      pullRequest,
      // The comment carries no title, and a delivery for one event must not go
      // and fetch the pull request to find one: `owner/repo#7` is what the board
      // shows anyway, and the next `pull_request` event does not overwrite it.
      title: formatPullRequest(pullRequest),
      authorLogin,
      requiredSkills: [],
      priority: 'normal' as const,
      dueAt: null,
    }
  }

  private async tracked(pullRequest: PullRequestRef): Promise<ReviewRequest | null> {
    return this.container.repositories.reviews.getByPullRequest(pullRequest)
  }

  /** Best-effort: the work is committed, and a failed reply must not undo it. */
  private async reply(pullRequest: PullRequestRef, body: string): Promise<void> {
    const vcs = await resolveVcs(this.container)
    if (vcs === null) return
    try {
      await vcs.gateway.comment(pullRequest, body)
    } catch (err) {
      this.container.logger.warn({ err }, 'could not answer a bot mention on the pull request')
    }
  }
}

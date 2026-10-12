import type { CreateReviewRequest, PullRequestRef, ReviewRequest } from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'
import { formatPullRequest, getErrorMessage, isDomainError, upstreamOf } from '@sainte-beuve/kernel'
import type { IntakeIntent, IntakeReview } from '@sainte-beuve/integrations'
import { PAST_REVIEW_STATUSES } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { readPullRequestAuthor } from '../reviews/pullRequestAuthor.js'
import { ReviewService } from '../reviews/ReviewService.js'
import { botReply } from './botReplies.js'

/**
 * What a verified delivery asks of the board, performed. One service for every
 * host: GitHub and GitLab each read their own payload into an `IntakeIntent`,
 * place it in an org, and hand it here bound to that org.
 *
 * Deliveries are handled INLINE rather than queued. A host's own guidance is to
 * ack fast and work asynchronously, and it earns its keep when the work is a
 * repository backfill; here the work is one or two writes against a store the
 * request already holds, so a queue would add a binding, a consumer and a second
 * failure mode to save a few milliseconds. If a handler ever grows to where that
 * stops being true, the seam to add is behind `perform`.
 */

/**
 * The faults a public comment states without describing. Each names who can
 * fix it, because the person reading the comment usually cannot: an
 * unconfigured integration is an operator's job, and telling a repository which
 * variable is unset tells everybody who can read it.
 */
const NOT_CONFIGURED =
  'this deployment is not set up for that yet. Whoever operates sainte-beuve can see what is ' +
  'missing in its logs'
const UNEXPECTED =
  'something went wrong here. Whoever operates sainte-beuve can see what it was in the logs'
const UPSTREAM_DECLINED =
  'cat-factory declined the request. Whoever operates sainte-beuve can see why in its logs'
const NOT_ALLOWED = 'that is not something this pull request can ask for here'

function upstreamRefused(pullRequest: PullRequestRef): string {
  return (
    `${vcsDisplayName(pullRequest.provider)} refused the request. Whoever operates ` +
    'sainte-beuve can see the refusal in its logs'
  )
}

/**
 * The codes whose message is about the BOARD and may be repeated in public, when
 * this deployment wrote it. An allow-list rather than the faults to hide,
 * because a code added later is then withheld until somebody decides otherwise.
 */
const BOARD_ANSWERS = new Set(['not_found', 'validation', 'conflict'])

/** What the delivery caused, for the ack body and the log line. */
export interface IntakeOutcome {
  /** The intent that was performed, or `ignored` for a delivery that asked for nothing. */
  action: string
  reviewId: string | null
}

export const IGNORED: IntakeOutcome = { action: 'ignored', reviewId: null }
export const UNREGISTERED: IntakeOutcome = { action: 'ignored:unregistered', reviewId: null }

type CommandIntent = Extract<IntakeIntent, { kind: 'command' }>

export class ReviewIntake {
  /** Bound to the org the delivery was placed in. */
  constructor(private readonly container: AppContainer) {}

  async perform(intent: IntakeIntent): Promise<IntakeOutcome> {
    if (intent.kind === 'track') return this.track(intent)
    if (intent.kind === 'ai_review') return this.delegate(intent)
    if (intent.kind === 'command') return this.command(intent)
    // An event about a pull request nobody tracked is not a fault: a repository
    // has open pull requests that predate the intake, and closing one of those
    // is simply not our business.
    const review = await this.tracked(intent.pullRequest)
    if (review === null) return IGNORED
    // Closing never erases a verdict. Merging is how an approved pull request
    // usually ends, and the review history counts who reviewed it by its verdict.
    if (intent.kind === 'close' && PAST_REVIEW_STATUSES.includes(review.status)) {
      return { action: 'ignored:settled', reviewId: review.id }
    }
    const status = statusAfter(intent, review)
    if (status === null) return IGNORED
    await new ReviewService(this.container).updateStatus(review.id, status)
    return { action: status, reviewId: review.id }
  }

  private async track(intent: Extract<IntakeIntent, { kind: 'track' }>): Promise<IntakeOutcome> {
    const service = new ReviewService(this.container)
    const draft = await this.withAuthor(intent.review)
    const { review, created, result } = intent.route
      ? await service.trackAndAssign(draft, 1)
      : { ...(await service.track(draft)), result: null }
    if (result === null) {
      return { action: created ? 'tracked' : 'already_tracked', reviewId: review.id }
    }
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
  private async delegate(
    intent: Extract<IntakeIntent, { kind: 'ai_review' }>,
  ): Promise<IntakeOutcome> {
    const { review } = await new ReviewService(this.container).track(
      await this.withAuthor(blankReview(intent.pullRequest, intent.author)),
    )
    try {
      const run = await new AiReviewService(this.container).request(review.id, null)
      return { action: `ai_review:${run.status}`, reviewId: review.id }
    } catch (err) {
      // Acked, not raised. A label is not a request better credentials would
      // fix, and a 5xx makes the host redeliver: `track` is idempotent but a run
      // is not, so every retry would write another run row and, once
      // cat-factory is configured, submit another paid job. The refusal is for
      // an operator, so it goes to the log rather than onto the pull request.
      this.container.logger.warn(
        { err, reviewId: review.id },
        'the AI-review label could not be delegated',
      )
      return { action: 'ai_review:refused', reviewId: review.id }
    }
  }

  /**
   * A comment that @-mentioned the bot. The bot ALWAYS answers, including when it
   * refuses: a mention that produces silence is indistinguishable from a webhook
   * that never arrived, and the person who typed it has no other way to tell.
   */
  private async command(intent: CommandIntent): Promise<IntakeOutcome> {
    const outcome = await this.runCommand(intent)
    await this.reply(intent.pullRequest, outcome.body)
    return { action: `command:${intent.verb}`, reviewId: outcome.reviewId }
  }

  private async runCommand(
    intent: CommandIntent,
  ): Promise<{ body: string; reviewId: string | null }> {
    const reviews = new ReviewService(this.container)
    try {
      if (intent.verb === 'status') return this.status(intent.pullRequest)
      const { review } = await reviews.track(
        await this.withAuthor(blankReview(intent.pullRequest, intent.author)),
      )
      if (intent.verb === 'ai') {
        const run = await new AiReviewService(this.container).request(review.id, null)
        return { body: botReply.aiRequested(run), reviewId: review.id }
      }
      if (intent.verb === 'reroll') {
        const rerolled = await reviews.reroll(review.id)
        return { body: botReply.rerolled(rerolled), reviewId: review.id }
      }
      const result = await reviews.assign(review.id, { count: 1, excludeReviewerIds: [] })
      return { body: botReply.assigned(result), reviewId: review.id }
    } catch (err) {
      // The refusal is the answer: a mention that produces silence is
      // indistinguishable from a webhook that never arrived. What it may SAY is
      // narrower than what an operator gets, because this comment is public.
      return { body: botReply.failed(this.publicReason(err, intent.pullRequest)), reviewId: null }
    }
  }

  /**
   * What the bot is allowed to say about a failure.
   *
   * A pull-request comment is readable by anybody who can see the repository,
   * and the refusals reaching here are written for an operator: a
   * `requireCapability` message names a deployment variable, the encryption key
   * or which half of cat-factory's configuration is missing, and a cat-factory
   * refusal embeds cat-factory's own response text and what this deployment's
   * key lacks. So the comment gets the SHAPE of the fault and the operator's copy
   * stays in the log, which is where somebody who can act on it is looking.
   *
   * What does go through unchanged is the board's own answer ("no reviewer
   * rev-3", "a run is already in flight"), because that is what the person who
   * asked actually needs. The same codes from cat-factory are NOT the board's,
   * and `upstreamOf` is how the two are told apart.
   */
  private publicReason(err: unknown, pullRequest: PullRequestRef): string {
    const code = isDomainError(err) ? err.code : 'internal'
    this.container.logger.warn({ err, code }, 'a bot command was refused')
    // Before the codes, because cat-factory's refusals reuse them: its rate limit
    // is `unavailable`, which is not this deployment missing configuration.
    if (upstreamOf(err) !== null) return UPSTREAM_DECLINED
    if (code === 'unavailable' || code === 'misconfigured') return NOT_CONFIGURED
    if (code === 'upstream_failed') return upstreamRefused(pullRequest)
    if (code === 'forbidden') return NOT_ALLOWED
    return BOARD_ANSWERS.has(code) ? getErrorMessage(err) : UNEXPECTED
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

  /**
   * The review request with an author, asking the host when the payload named
   * none. Only for a row about to be opened: a tracked review keeps the author it
   * has, and tracking it again writes nothing, so it costs no request.
   */
  private async withAuthor(review: IntakeReview): Promise<CreateReviewRequest> {
    if (review.authorLogin !== null) return { ...review, authorLogin: review.authorLogin }
    const existing = await this.tracked(review.pullRequest)
    const authorLogin =
      existing?.authorLogin ?? (await readPullRequestAuthor(this.container, review.pullRequest))
    return { ...review, authorLogin }
  }

  private async tracked(pullRequest: PullRequestRef): Promise<ReviewRequest | null> {
    return this.container.repositories.reviews.getByPullRequest(pullRequest)
  }

  /** Best-effort: the work is committed, and a failed reply must not undo it. */
  private async reply(pullRequest: PullRequestRef, body: string): Promise<void> {
    const vcs = await resolveVcs(this.container, pullRequest.provider)
    if (vcs === null) return
    try {
      await vcs.gateway.comment(pullRequest, body)
    } catch (err) {
      this.container.logger.warn({ err }, 'could not answer a bot mention on the pull request')
    }
  }
}

/**
 * The status a settling intent moves a tracked review to, or null when it moves
 * nothing. An approval taken back re-opens only a review the approval had
 * settled: one already closed, or settled with changes requested, stays where it
 * is.
 */
function statusAfter(
  intent: Extract<IntakeIntent, { kind: 'close' | 'resolve' | 'unapprove' }>,
  review: ReviewRequest,
): ReviewRequest['status'] | null {
  if (intent.kind === 'close') return 'closed'
  if (intent.kind === 'resolve') return intent.status
  if (review.status !== 'approved') return null
  return review.assignedReviewerIds.length > 0 ? 'assigned' : 'open'
}

function blankReview(pullRequest: PullRequestRef, authorLogin: string | null): IntakeReview {
  return {
    pullRequest,
    // A comment or a label carries no title, and a delivery for one event must
    // not go and fetch the pull request to find one: `owner/repo#7` is what the
    // board shows anyway, and the next opening event does not overwrite it.
    title: formatPullRequest(pullRequest),
    authorLogin,
    requiredSkills: [],
    priority: 'normal' as const,
    dueAt: null,
  }
}

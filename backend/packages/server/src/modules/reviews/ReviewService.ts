import type {
  AssignReviewersResult,
  CreateReviewRequest,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import { ConflictError, assertFound } from '@sainte-beuve/kernel'
import { isSameGithubLogin, selectReviewers } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'
import { scheduleNextReminder } from '../../reminders/schedule.js'
import { announceReview } from './announce.js'

/**
 * Review-request use cases: register a pull request, hand it to reviewers, move it
 * through its statuses.
 *
 * The service owns the WRITES and the ordering; the decisions stay in the pure
 * packages (`@sainte-beuve/reviewers` picks, `@sainte-beuve/reminders` schedules),
 * so the policy is testable without a store and this file stays about consistency:
 * what gets written, in which order, and what has to be undone when a step fails.
 */
export class ReviewService {
  constructor(private readonly container: AppContainer) {}

  async create(input: CreateReviewRequest): Promise<ReviewRequest> {
    const { repositories, clock, ids } = this.container
    const existing = await repositories.reviews.getByPullRequest(input.pullRequest)
    if (existing !== null) {
      throw new ConflictError(
        `${input.pullRequest.owner}/${input.pullRequest.repo}#${input.pullRequest.number} is already tracked`,
        { reviewId: existing.id },
      )
    }
    const now = clock.now()
    const review = await repositories.reviews.create({
      id: ids.next(),
      pullRequest: input.pullRequest,
      title: input.title,
      authorLogin: input.authorLogin,
      requiredSkills: input.requiredSkills,
      priority: input.priority,
      status: 'open',
      assignedReviewerIds: [],
      createdAt: now,
      updatedAt: now,
      assignedAt: null,
      dueAt: input.dueAt,
    })
    await scheduleNextReminder(this.container, review)
    await announceReview(this.container, review)
    return review
  }

  /**
   * The review request for a pull request, creating it if this is the first we
   * have heard of it.
   *
   * The idempotent twin of `create`, for the callers that are not a person
   * clicking a button: GitHub redelivers, a webhook fires for `opened` and again
   * when a label lands, and both have to converge on one row rather than on a
   * 409. `created` is returned because the two cases read differently to whoever
   * asked (a bot reply says "tracked" or "already tracked"), and because only the
   * first one is worth announcing.
   */
  async track(input: CreateReviewRequest): Promise<{ review: ReviewRequest; created: boolean }> {
    const existing = await this.container.repositories.reviews.getByPullRequest(input.pullRequest)
    if (existing !== null) return { review: existing, created: false }
    return { review: await this.create(input), created: true }
  }

  /**
   * Put one named person on the hook, rather than asking the router to pick.
   *
   * This is what "I will take it" means, from a Slack button or a pull-request
   * comment. It deliberately skips the skill gate the router applies: somebody
   * volunteering has made a judgement about their own competence that a label map
   * is not in a position to overrule.
   */
  async claim(reviewId: string, reviewerId: string): Promise<ReviewRequest> {
    const { repositories, clock } = this.container
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const reviewer = assertFound(
      await repositories.reviewers.getById(reviewerId),
      `No reviewer ${reviewerId}`,
    )
    if (review.assignedReviewerIds.includes(reviewerId)) return review
    const updated = await this.recordAssignment(review, [reviewerId], clock.now())
    await this.mirrorToVcs(updated, [reviewer.githubLogin])
    return updated
  }

  async assign(
    reviewId: string,
    input: { count: number; excludeReviewerIds: string[] },
  ): Promise<AssignReviewersResult> {
    const { repositories, clock, random } = this.container
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const candidates = await repositories.reviewers.list()
    const result = selectReviewers(
      {
        candidates,
        requiredSkills: review.requiredSkills,
        // The author and whoever is already on the hook are excluded here rather
        // than by the caller: a client that forgot would otherwise get a reviewer
        // reviewing their own pull request, which the router must never produce.
        excludeReviewerIds: [
          ...input.excludeReviewerIds,
          ...review.assignedReviewerIds,
          ...candidates
            .filter((r) => isSameGithubLogin(r.githubLogin, review.authorLogin))
            .map((r) => r.id),
        ],
        count: input.count,
      },
      random,
    )

    const updated = await this.recordAssignment(
      review,
      result.selected.map((r) => r.id),
      clock.now(),
    )
    await this.mirrorToVcs(
      updated,
      result.selected.map((r) => r.githubLogin),
    )
    return {
      review: updated,
      assigned: result.selected.map((r) => ({ reviewerId: r.id, displayName: r.displayName })),
      shortfallReason: result.shortfallReason,
    }
  }

  async updateStatus(reviewId: string, status: ReviewStatus): Promise<ReviewRequest> {
    const { repositories, clock } = this.container
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const updated = assertFound(
      await repositories.reviews.update(reviewId, { status, updatedAt: clock.now() }),
      `No review request ${reviewId}`,
    )
    await this.moveOutstanding(review, status)
    if (isTerminal(status)) {
      await repositories.reminders.cancelScheduledForReview(reviewId)
      return updated
    }
    await scheduleNextReminder(this.container, updated)
    return updated
  }

  /** Write the assignment and move the reviewers' outstanding counters with it. */
  private async recordAssignment(
    review: ReviewRequest,
    reviewerIds: string[],
    now: number,
  ): Promise<ReviewRequest> {
    const { repositories } = this.container
    if (reviewerIds.length === 0) return review
    const assignedReviewerIds = [...review.assignedReviewerIds, ...reviewerIds]
    const updated = assertFound(
      await repositories.reviews.update(review.id, {
        assignedReviewerIds,
        status: review.status === 'open' ? 'assigned' : review.status,
        assignedAt: review.assignedAt ?? now,
        updatedAt: now,
      }),
      `No review request ${review.id}`,
    )
    for (const reviewerId of reviewerIds) {
      await repositories.reviewers.adjustOutstanding(reviewerId, 1)
    }
    await scheduleNextReminder(this.container, updated)
    return updated
  }

  /**
   * Mirror the assignment onto the pull request. Best-effort on purpose: GitHub
   * being down must not lose an assignment we have already committed, and the
   * reviewer still gets their Slack nudge. The failure is logged, not swallowed
   * silently.
   */
  private async mirrorToVcs(review: ReviewRequest, logins: (string | null)[]): Promise<void> {
    const { logger } = this.container
    const known = logins.filter((login): login is string => login !== null)
    if (known.length === 0) return
    const vcs = await resolveVcs(this.container)
    if (vcs === null) return
    try {
      await vcs.gateway.requestReviewers(review.pullRequest, known)
    } catch (err) {
      logger.warn({ err, reviewId: review.id }, 'could not mirror the assignment to the PR')
    }
  }

  /**
   * Move the reviewers' outstanding counters on the TRANSITION, never on the write.
   * A webhook replay that closes an already-closed review must not release its
   * reviewers a second time (the counter would under-report their load for good,
   * and selection would draw them more often than they deserve), and reopening one
   * has to put the same people back on the hook.
   */
  private async moveOutstanding(review: ReviewRequest, next: ReviewStatus): Promise<void> {
    const wasTerminal = isTerminal(review.status)
    if (wasTerminal === isTerminal(next)) return
    const delta = wasTerminal ? 1 : -1
    for (const reviewerId of review.assignedReviewerIds) {
      await this.container.repositories.reviewers.adjustOutstanding(reviewerId, delta)
    }
  }
}

function isTerminal(status: ReviewStatus): boolean {
  return status === 'approved' || status === 'changes_requested' || status === 'closed'
}

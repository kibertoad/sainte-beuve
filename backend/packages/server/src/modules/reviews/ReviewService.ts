import type {
  AssignReviewersResult,
  CreateReviewRequest,
  Reviewer,
  ReviewRequest,
  ReviewStatus,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import { ConflictError, assertFound } from '@sainte-beuve/kernel'
import { isSameHandle, selectReviewers } from '@sainte-beuve/reviewers'
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
    const { repositories } = this.container
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const reviewer = assertFound(
      await repositories.reviewers.getById(reviewerId),
      `No reviewer ${reviewerId}`,
    )
    if (review.assignedReviewerIds.includes(reviewerId)) return review
    const provider = review.pullRequest.provider
    const updated = await this.recordAssignment(review, { assign: [reviewerId], release: [] })
    await this.mirrorToVcs(updated, {
      request: [handleOf(reviewer.handles, provider)],
      withdraw: [],
    })
    return updated
  }

  async assign(
    reviewId: string,
    input: { count: number; excludeReviewerIds: string[] },
  ): Promise<AssignReviewersResult> {
    const review = await this.require(reviewId)
    return this.handOver(review, { count: input.count, exclude: input.excludeReviewerIds })
  }

  /**
   * Hand the review to somebody else: whoever holds it comes OFF as the
   * replacement goes on.
   *
   * A reroll is not an assign with an exclusion list. Excluding the incumbent is
   * only half the gesture; the other half is taking the review off them, and
   * appending instead would leave two people assigned, the first still counted
   * as busy and still being chased by the reminder ladder, while the reply named
   * only the second.
   *
   * When nobody else can take it, the incumbent KEEPS it. "Nobody else is
   * available" must not be a way to end up with a review nobody is on.
   */
  async reroll(reviewId: string): Promise<AssignReviewersResult> {
    const review = await this.require(reviewId)
    return this.handOver(review, {
      count: 1,
      exclude: review.assignedReviewerIds,
      release: review.assignedReviewerIds,
    })
  }

  private async handOver(
    review: ReviewRequest,
    input: { count: number; exclude: string[]; release?: string[] },
  ): Promise<AssignReviewersResult> {
    const { repositories, random } = this.container
    // The author is matched on the handle for the pull request's OWN host: the
    // same person is spelled differently on each, and comparing against the
    // wrong one would put them in their own review's candidate pool.
    const provider = review.pullRequest.provider
    const candidates = await repositories.reviewers.list()
    const result = selectReviewers(
      {
        candidates,
        requiredSkills: review.requiredSkills,
        // The author and whoever is already on the hook are excluded here rather
        // than by the caller: a client that forgot would otherwise get a reviewer
        // reviewing their own pull request, which the router must never produce.
        excludeReviewerIds: [
          ...input.exclude,
          ...review.assignedReviewerIds,
          ...candidates
            .filter((r) => isSameHandle(handleOf(r.handles, provider), review.authorLogin))
            .map((r) => r.id),
        ],
        count: input.count,
      },
      random,
    )
    const assigned = result.selected.map((r) => ({ reviewerId: r.id, displayName: r.displayName }))
    if (result.selected.length === 0) {
      return { review, assigned, shortfallReason: result.shortfallReason }
    }
    const release = input.release ?? []
    const updated = await this.recordAssignment(review, {
      assign: result.selected.map((r) => r.id),
      release,
    })
    await this.mirrorToVcs(updated, {
      request: result.selected.map((r) => handleOf(r.handles, provider)),
      withdraw: handlesOf(candidates, release, provider),
    })
    return { review: updated, assigned, shortfallReason: result.shortfallReason }
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

  /**
   * Write who is on the hook and move the reviewers' outstanding counters with
   * it, in one update: the assignment and the counters are the same fact, and a
   * release that landed without the decrement would leave whoever was rerolled
   * looking permanently busier than they are, which is a load the router keeps
   * reading for ever.
   */
  private async recordAssignment(
    review: ReviewRequest,
    change: { assign: string[]; release: string[] },
  ): Promise<ReviewRequest> {
    const { repositories, clock } = this.container
    if (change.assign.length === 0 && change.release.length === 0) return review
    const now = clock.now()
    // Only the ids that were actually on the review are released, so a caller
    // handing over a stale list cannot decrement a counter twice.
    const released = new Set(review.assignedReviewerIds.filter((id) => change.release.includes(id)))
    const assignedReviewerIds = [
      ...review.assignedReviewerIds.filter((id) => !released.has(id)),
      ...change.assign,
    ]
    const updated = assertFound(
      await repositories.reviews.update(review.id, {
        assignedReviewerIds,
        status: review.status === 'open' ? 'assigned' : review.status,
        assignedAt: review.assignedAt ?? now,
        updatedAt: now,
      }),
      `No review request ${review.id}`,
    )
    for (const reviewerId of released) {
      await repositories.reviewers.adjustOutstanding(reviewerId, -1)
    }
    for (const reviewerId of change.assign) {
      await repositories.reviewers.adjustOutstanding(reviewerId, 1)
    }
    await scheduleNextReminder(this.container, updated)
    return updated
  }

  /**
   * Mirror the assignment onto the pull request: the new reviewers requested,
   * and the ones who no longer hold it withdrawn.
   *
   * Best-effort on purpose: GitHub being down must not lose an assignment we
   * have already committed, and the reviewer still gets their Slack nudge. The
   * failure is logged, not swallowed silently. The withdrawal goes first, so the
   * last notification GitHub sends is the one that puts somebody ON the hook.
   */
  private async mirrorToVcs(
    review: ReviewRequest,
    change: { request: (string | null)[]; withdraw: (string | null)[] },
  ): Promise<void> {
    const { logger } = this.container
    const request = known(change.request)
    const withdraw = known(change.withdraw).filter((login) => !request.includes(login))
    if (request.length === 0 && withdraw.length === 0) return
    const vcs = await resolveVcs(this.container, review.pullRequest.provider)
    if (vcs === null) return
    try {
      if (withdraw.length > 0) {
        await vcs.gateway.removeRequestedReviewers(review.pullRequest, withdraw)
      }
      if (request.length > 0) await vcs.gateway.requestReviewers(review.pullRequest, request)
    } catch (err) {
      logger.warn({ err, reviewId: review.id }, 'could not mirror the assignment to the PR')
    }
  }

  private async require(reviewId: string): Promise<ReviewRequest> {
    return assertFound(
      await this.container.repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
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

/** The named reviewers' handles on the pull request's host, for the mirror. */
function handlesOf(
  candidates: Reviewer[],
  reviewerIds: string[],
  provider: VcsProvider,
): (string | null)[] {
  return reviewerIds.map((id) => {
    const reviewer = candidates.find((r) => r.id === id)
    return reviewer === undefined ? null : handleOf(reviewer.handles, provider)
  })
}

/** A reviewer with no account on that host cannot be mirrored, and is not a failure. */
function known(logins: (string | null)[]): string[] {
  return logins.filter((login): login is string => login !== null)
}

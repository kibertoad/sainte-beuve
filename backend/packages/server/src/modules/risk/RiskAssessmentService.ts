import type {
  PullRequestStatus,
  ReviewRequest,
  RiskAssessment,
  RiskPolicy,
} from '@sainte-beuve/contracts'
import { RISK_ASSESSMENT_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import {
  ConflictError,
  getErrorMessage,
  NotFoundError,
  UnavailableError,
  type VcsGateway,
} from '@sainte-beuve/kernel'
import { assessmentOf } from '../assessments/PullRequestAssessmentService.js'
import { aiReviewOutcome } from '@sainte-beuve/risk'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'
import { OrgService } from '../orgs/OrgService.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { ReviewService } from '../reviews/ReviewService.js'
import { advance, type AssessmentPatch, settleApproval } from './advance.js'
import { withdrawOnHost } from './hostApproval.js'
import { scorePullRequest } from './scoring.js'

/** How many times one assessment is tried before it is reported as failed. */
const MAX_ATTEMPTS = 3

/**
 * How long a step that just ran is left to its own driver before the clock
 * picks the row up too. Long enough for a cat-factory assessment to come back.
 */
export const DRIVE_LEASE_MS = 3 * 60_000

const WITHDRAWN =
  'New commits arrived after sainte-beuve approved this pull request, so the approval was withdrawn until the new head is assessed.'

const SUPERSEDED =
  'New commits arrived while sainte-beuve was approving this pull request, so the approval was withdrawn until the new head is assessed.'

const IN_FLIGHT = new Set<RiskAssessment['status']>(RISK_ASSESSMENT_IN_FLIGHT_STATUSES)

/** What a step knows about its pull request when it decides the next one. */
interface StepContext {
  policy: RiskPolicy
  status: PullRequestStatus
  aiReview: 'clean' | 'blocked' | null
}

/**
 * Assessing the board's pull requests against the org's risk policy, and
 * approving the ones it lets through.
 *
 * An assessment is a row that moves through its states one step at a time:
 * `pending` is scored, `awaiting_ai_review` waits on the AI review the policy
 * asked for. A step is started off the request that queued it (`defer`), so a
 * webhook is answered before a model is called, and the reminder clock drives
 * whatever is left in flight after the lease.
 *
 * Every write is a check and set on the row's revision. A step claims its row
 * before it runs, so two drivers never both act on it, and a step whose row was
 * restarted under it (new commits) writes nothing and takes back an approval it
 * gave on the old head.
 */
export class RiskAssessmentService {
  constructor(private readonly container: AppContainer) {}

  /**
   * Queue an assessment of a review the board just started tracking, or one
   * whose pull request gained commits. Null when the org assesses nothing.
   */
  async queue(review: ReviewRequest): Promise<RiskAssessment | null> {
    const policy = await this.policy()
    if (!policy.assess) return null
    return this.start(review, policy)
  }

  /**
   * New commits on a tracked pull request. An approval given here was about the
   * old head, so it is withdrawn and the review goes back on the clock before
   * the new head is assessed.
   */
  async onNewCommits(review: ReviewRequest): Promise<RiskAssessment | null> {
    const held = await this.container.repositories.riskAssessments.get(review.id)
    if (held?.status === 'approved') await this.withdraw(held, review)
    return this.queue(review)
  }

  /** Assess a review again on request, whatever the policy says about doing it unprompted. */
  async request(reviewId: string): Promise<RiskAssessment> {
    const review = await this.review(reviewId)
    const held = await this.container.repositories.riskAssessments.get(reviewId)
    if (held !== null && IN_FLIGHT.has(held.status)) {
      throw new ConflictError('this pull request is already being assessed')
    }
    return this.start(review, await this.policy())
  }

  async get(reviewId: string): Promise<RiskAssessment | null> {
    await this.review(reviewId)
    return this.container.repositories.riskAssessments.get(reviewId)
  }

  async listByReviews(reviewIds: readonly string[]): Promise<RiskAssessment[]> {
    return this.container.repositories.riskAssessments.listByReviews(reviewIds)
  }

  /** Drive what the org has in flight and its own driver has let go of. Answers how many moved. */
  async sweepInFlight(limit: number): Promise<number> {
    const { repositories, clock } = this.container
    const due = clock.now() - DRIVE_LEASE_MS
    const rows = await repositories.riskAssessments.listInFlight(limit)
    let driven = 0
    for (const row of rows.filter((candidate) => candidate.updatedAt <= due)) {
      if ((await this.step(row)) !== null) driven += 1
    }
    return driven
  }

  /** Run one step for a review's assessment, if it is still in flight and nobody else claimed it. */
  async drive(reviewId: string): Promise<void> {
    const row = await this.container.repositories.riskAssessments.get(reviewId)
    if (row !== null && IN_FLIGHT.has(row.status)) await this.step(row)
  }

  private async start(review: ReviewRequest, policy: RiskPolicy): Promise<RiskAssessment> {
    const now = this.container.clock.now()
    const row: RiskAssessment = {
      reviewId: review.id,
      pullRequest: review.pullRequest,
      status: 'pending',
      assessor: policy.assessor,
      headSha: null,
      changeClass: null,
      changedFileCount: null,
      scores: null,
      rationale: null,
      verdict: null,
      holdReason: null,
      aiReviewRunId: null,
      approvedAs: null,
      approvalId: null,
      attempts: 0,
      revision: this.container.ids.next(),
      requestedAt: now,
      updatedAt: now,
    }
    await this.container.repositories.riskAssessments.put(row)
    this.container.defer(this.drive(review.id))
    return row
  }

  /** New commits on an approved pull request: the approval goes, and the board row back on the clock. */
  private async withdraw(held: RiskAssessment, review: ReviewRequest): Promise<void> {
    await withdrawOnHost(this.container, review, {
      approvalId: held.approvalId,
      message: WITHDRAWN,
    })
    if (review.status === 'approved') {
      const reopened = review.assignedReviewerIds.length > 0 ? 'assigned' : 'open'
      await new ReviewService(this.container).updateStatus(review.id, reopened)
    }
    await this.save(held, { status: 'requires_review', holdReason: WITHDRAWN, approvalId: null })
  }

  /**
   * One step, with a failure recorded on the row rather than thrown. Null when
   * another driver claimed the row first, or new commits restarted it.
   */
  private async step(stale: RiskAssessment): Promise<RiskAssessment | null> {
    // The claim: it also stamps the row, so the clock leaves it alone while this runs.
    const row = await this.save(stale, {})
    if (row === null) return null
    try {
      const review = await this.container.repositories.reviews.getById(row.reviewId)
      if (review === null) {
        return await this.save(row, { status: 'failed', holdReason: 'its review is gone' })
      }
      return row.status === 'pending'
        ? await this.score(row, review)
        : await this.settleAiReview(row, review)
    } catch (err) {
      return this.failed(row, err)
    }
  }

  private async score(row: RiskAssessment, review: ReviewRequest): Promise<RiskAssessment | null> {
    const policy = await this.policy()
    const vcs = await this.vcs(review)
    const status = await vcs.pullRequestStatus(review.pullRequest)
    if (status.state !== 'open') {
      return this.save(row, {
        status: 'failed',
        holdReason: 'the pull request was closed before it was assessed',
      })
    }
    const scored = await scorePullRequest(this.container, {
      vcs,
      pullRequest: review.pullRequest,
      headSha: status.headSha,
      policy,
    })
    // cat-factory's scores are what the lists show for a pull request; the heuristic's are not.
    if (policy.assessor === 'cat-factory') {
      await this.container.repositories.pullRequestAssessments.put(
        assessmentOf(review.pullRequest, scored, this.container.clock.now()),
      )
    }
    const assessed = await this.save(row, {
      ...scored,
      assessor: policy.assessor,
      aiReviewRunId: null,
      attempts: row.attempts + 1,
    })
    if (assessed === null) return null
    return this.advanced(assessed, review, { policy, status, aiReview: null })
  }

  private async settleAiReview(
    row: RiskAssessment,
    review: ReviewRequest,
  ): Promise<RiskAssessment | null> {
    if (row.aiReviewRunId === null) return this.save(row, { status: 'pending' })
    const policy = await this.policy()
    const run = await new AiReviewService(this.container).get(row.aiReviewRunId)
    const outcome = aiReviewOutcome(run, policy.blockingSeverity)
    if (outcome === null) return row
    const status = await (await this.vcs(review)).pullRequestStatus(review.pullRequest)
    return this.advanced(row, review, { policy, status, aiReview: outcome })
  }

  private async advanced(
    row: RiskAssessment,
    review: ReviewRequest,
    context: StepContext,
  ): Promise<RiskAssessment | null> {
    if (row.verdict === null || row.headSha === null) return this.save(row, { status: 'pending' })
    const patch: AssessmentPatch = await advance(
      this.container,
      {
        review,
        verdict: row.verdict,
        headSha: row.headSha,
        scores: row.scores,
        aiReviewRunId: row.aiReviewRunId,
      },
      context,
    )
    const next = await this.save(row, patch)
    if (patch.status === 'approved') {
      if (next === null) await this.retract(row, review, patch)
      else await settleApproval(this.container, review, row.aiReviewRunId)
      return next
    }
    // New commits: assess the new head straight away, within the attempt budget.
    if (next?.status === 'pending' && next.attempts < MAX_ATTEMPTS) {
      this.container.defer(this.drive(row.reviewId))
    }
    return next
  }

  /**
   * An approval whose row was restarted under it was about code that may no
   * longer be the head, so it is taken back. One a second driver also recorded
   * at the same head is left alone: on GitLab, taking back one account's
   * approval takes back both.
   */
  private async retract(
    row: RiskAssessment,
    review: ReviewRequest,
    patch: AssessmentPatch,
  ): Promise<void> {
    const current = await this.container.repositories.riskAssessments.get(row.reviewId)
    if (current?.status === 'approved' && current.headSha === row.headSha) return
    await withdrawOnHost(this.container, review, {
      approvalId: patch.approvalId ?? null,
      message: SUPERSEDED,
    })
  }

  private async failed(row: RiskAssessment, err: unknown): Promise<RiskAssessment | null> {
    const attempts = row.attempts + 1
    const reason = getErrorMessage(err)
    this.container.logger.warn(
      { err, reviewId: row.reviewId, attempts },
      'a risk assessment step failed',
    )
    return attempts >= MAX_ATTEMPTS
      ? this.save(row, { status: 'failed', holdReason: reason, attempts })
      : this.save(row, { holdReason: reason, attempts })
  }

  /** Write over the revision `row` was read at. Null when somebody else wrote first. */
  private async save(
    row: RiskAssessment,
    patch: Partial<RiskAssessment>,
  ): Promise<RiskAssessment | null> {
    const { repositories, clock, ids } = this.container
    const next = { ...row, ...patch, revision: ids.next(), updatedAt: clock.now() }
    return (await repositories.riskAssessments.replace(next, row.revision)) ? next : null
  }

  private async vcs(review: ReviewRequest): Promise<VcsGateway> {
    const resolved = await resolveVcs(this.container, review.pullRequest.provider)
    if (resolved === null) {
      throw new UnavailableError(
        `no credential reaches ${review.pullRequest.provider} to read the pull request`,
      )
    }
    return resolved.gateway
  }

  private async review(reviewId: string): Promise<ReviewRequest> {
    const review = await this.container.repositories.reviews.getById(reviewId)
    if (review === null) throw new NotFoundError(`No review request ${reviewId}`)
    return review
  }

  private async policy(): Promise<RiskPolicy> {
    return (await new OrgService(this.container).current()).riskPolicy
  }
}

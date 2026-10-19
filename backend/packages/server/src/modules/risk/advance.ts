import type {
  AiReviewRun,
  PullRequestStatus,
  ReviewRequest,
  RiskAssessment,
  RiskPolicy,
  RiskVerdict,
} from '@sainte-beuve/contracts'
import { ConflictError, getErrorMessage } from '@sainte-beuve/kernel'
import { type AiReviewJudgement, planApproval } from '@sainte-beuve/risk'
import type { AppContainer } from '../../container.js'
import { type Approver, resolveApprover } from '../../integrations/riskResolve.js'
import { AiReviewCurationService } from '../reviews/AiReviewCurationService.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { ReviewService } from '../reviews/ReviewService.js'
import { approveOnHost } from './hostApproval.js'

/** What a step changes on the assessment row. */
export type AssessmentPatch = Partial<
  Pick<RiskAssessment, 'status' | 'holdReason' | 'aiReviewRunId' | 'approvedAs' | 'approvalId'>
>

/** An assessment with a verdict, and what is known about its pull request now. */
export interface Assessed {
  review: ReviewRequest
  verdict: RiskVerdict
  headSha: string
  scores: RiskAssessment['scores']
  aiReviewRunId: string | null
  /** When the assessment was requested: a review filed since then is about the same head. */
  requestedAt: number
}

const AI_REVIEW_INSTRUCTIONS =
  'Filed automatically: this pull request is within the risk policy, and it is approved with nobody looking if this review finds nothing a person should see.'

function approvalBody(assessed: Assessed, aiReview: AiReviewJudgement | null): string {
  const { verdict, scores } = assessed
  const read =
    scores === null
      ? ''
      : ` (complexity ${scores.complexity}, risk ${scores.risk}, impact ${scores.impact})`
  const review =
    aiReview === null
      ? ''
      : ` An AI review rated it ${aiReview.rating} and found nothing at the threshold the policy sets.`
  return `Approved by sainte-beuve: the change is within the ${verdict.policyName} risk policy${read}.${review}`
}

async function approve(
  container: AppContainer,
  assessed: Assessed,
  input: { approver: Approver; aiReview: AiReviewJudgement | null },
): Promise<AssessmentPatch> {
  const { review, headSha } = assessed
  const { approver } = input
  let approval: { approvalId: string | null }
  try {
    approval = await approveOnHost(container, approver, review, {
      headSha,
      body: approvalBody(assessed, input.aiReview),
    })
  } catch (err) {
    if (err instanceof ConflictError) {
      return { status: 'pending', holdReason: 'new commits arrived while it was being approved' }
    }
    return {
      status: 'within_policy',
      holdReason: `the approval was refused: ${getErrorMessage(err)}`,
    }
  }
  return {
    status: 'approved',
    approvedAs: approver.username,
    approvalId: approval.approvalId,
    holdReason: null,
  }
}

/**
 * What an approval recorded on its row settles: the board row, and the clean AI
 * review it waited on. Logged rather than thrown, since the host already holds
 * the approval and a retried step would only approve a second time.
 */
export async function settleApproval(
  container: AppContainer,
  review: ReviewRequest,
  aiReviewRunId: string | null,
): Promise<void> {
  try {
    await new ReviewService(container).updateStatus(review.id, 'approved')
  } catch (err) {
    container.logger.warn({ err, reviewId: review.id }, 'an approved review could not be marked')
  }
  if (aiReviewRunId !== null) await finishAiReview(container, aiReviewRunId)
}

/** Close a clean AI review without posting, so it does not wait on a curator. Best effort. */
async function finishAiReview(container: AppContainer, runId: string): Promise<void> {
  try {
    await new AiReviewCurationService(container).resolve(runId, {
      action: 'finish',
      findingIds: [],
    })
  } catch (err) {
    container.logger.warn({ err, runId }, 'a clean AI review could not be finished')
  }
}

/**
 * A review of this pull request filed since the assessment was requested, which
 * is a review of the head it scored: the one the org files when a pull request
 * opens, or one a person asked for. A review that never finished vouches for
 * nothing, so it is not adopted and another is filed.
 */
async function adoptableRun(
  container: AppContainer,
  assessed: Assessed,
): Promise<AiReviewRun | null> {
  const runs = await container.repositories.aiReviewRuns.listByReview(assessed.review.id)
  const candidates = runs.filter(
    (run) =>
      run.requestedAt >= assessed.requestedAt &&
      run.status !== 'failed' &&
      run.status !== 'cancelled',
  )
  return candidates.sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null
}

function awaiting(run: AiReviewRun): AssessmentPatch {
  return { status: 'awaiting_ai_review', aiReviewRunId: run.id, holdReason: null }
}

/**
 * Hand the pull request to the AI review the policy asks for: one already filed
 * on this head when there is one, so a pull request the org reviews on opening
 * is not reviewed, and billed, twice. A request that loses a race with another
 * filing adopts the winner.
 */
async function fileAiReview(container: AppContainer, assessed: Assessed): Promise<AssessmentPatch> {
  const adopted = await adoptableRun(container, assessed)
  if (adopted !== null) return awaiting(adopted)
  try {
    return awaiting(
      await new AiReviewService(container).request(assessed.review.id, AI_REVIEW_INSTRUCTIONS),
    )
  } catch (err) {
    const raced = err instanceof ConflictError ? await adoptableRun(container, assessed) : null
    if (raced !== null) return awaiting(raced)
    return {
      status: 'within_policy',
      holdReason: `the AI review the policy requires could not be filed: ${getErrorMessage(err)}`,
    }
  }
}

/**
 * Whether this org holds the claim on the pull request's repository. Anybody in
 * an org can track any pull request, and the approver may be the deployment's
 * GitHub App, which reaches every org's repositories: without the claim, one
 * org's policy could approve another org's code.
 */
async function holdsRepository(container: AppContainer, review: ReviewRequest): Promise<boolean> {
  const holder = await container.stores.tenancy.findOrgIdForProject(review.pullRequest)
  return holder === container.orgId
}

/**
 * Take the next step for an assessed pull request: hold it, file the AI review
 * the policy asks for, or approve it as the org's approver.
 */
export async function advance(
  container: AppContainer,
  assessed: Assessed,
  context: {
    policy: RiskPolicy
    status: PullRequestStatus
    aiReview: AiReviewJudgement | null
  },
): Promise<AssessmentPatch> {
  const { review, verdict, headSha } = assessed
  const wantsApprover = context.policy.autoApprove && verdict.outcome === 'within_policy'
  const approver = wantsApprover
    ? await resolveApprover(container, review.pullRequest.provider)
    : null
  const step = planApproval({
    repositoryHeld: wantsApprover && (await holdsRepository(container, review)),
    provider: review.pullRequest.provider,
    policy: context.policy,
    verdict,
    assessedHeadSha: headSha,
    pullRequest: context.status,
    approver,
    aiReview: context.aiReview,
  })
  if (step.kind === 'hold') return { status: step.status, holdReason: step.reason }
  if (step.kind === 'reassess') {
    return { status: 'pending', holdReason: 'new commits arrived since it was assessed' }
  }
  if (step.kind === 'ai_review') return fileAiReview(container, assessed)
  // `planApproval` approves only with an approver in hand.
  return approve(container, assessed, {
    approver: approver as Approver,
    aiReview: context.aiReview,
  })
}

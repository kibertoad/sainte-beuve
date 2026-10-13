import type {
  PullRequestStatus,
  ReviewRequest,
  RiskAssessment,
  RiskPolicy,
  RiskVerdict,
} from '@sainte-beuve/contracts'
import { ConflictError, getErrorMessage } from '@sainte-beuve/kernel'
import { planApproval } from '@sainte-beuve/risk'
import type { AppContainer } from '../../container.js'
import { type Approver, resolveApprover } from '../../integrations/riskResolve.js'
import { AiReviewCurationService } from '../reviews/AiReviewCurationService.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { ReviewService } from '../reviews/ReviewService.js'

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
}

const AI_REVIEW_INSTRUCTIONS =
  'Filed automatically: this pull request is within the risk policy, and it is approved with nobody looking if this review finds nothing a person should see.'

function approvalBody(assessed: Assessed, aiReviewed: boolean): string {
  const { verdict, scores } = assessed
  const read =
    scores === null
      ? ''
      : ` (complexity ${scores.complexity}, risk ${scores.risk}, impact ${scores.impact})`
  const review = aiReviewed ? ' An AI review found nothing at the threshold the policy sets.' : ''
  return `Approved by sainte-beuve: the change is within the ${verdict.policyName} risk policy${read}.${review}`
}

async function approve(
  container: AppContainer,
  assessed: Assessed,
  approver: Approver,
): Promise<AssessmentPatch> {
  const { review, headSha, aiReviewRunId } = assessed
  if (aiReviewRunId !== null) await finishAiReview(container, aiReviewRunId)
  let approval: { approvalId: string | null }
  try {
    approval = await approver.gateway.approve(review.pullRequest, {
      headSha,
      body: approvalBody(assessed, aiReviewRunId !== null),
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
  await new ReviewService(container).updateStatus(review.id, 'approved')
  return {
    status: 'approved',
    approvedAs: approver.username,
    approvalId: approval.approvalId,
    holdReason: null,
  }
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

async function fileAiReview(
  container: AppContainer,
  review: ReviewRequest,
): Promise<AssessmentPatch> {
  try {
    const run = await new AiReviewService(container).request(review.id, AI_REVIEW_INSTRUCTIONS)
    return { status: 'awaiting_ai_review', aiReviewRunId: run.id, holdReason: null }
  } catch (err) {
    return {
      status: 'within_policy',
      holdReason: `the AI review the policy requires could not be filed: ${getErrorMessage(err)}`,
    }
  }
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
    aiReview: 'clean' | 'blocked' | null
  },
): Promise<AssessmentPatch> {
  const { review, verdict, headSha } = assessed
  const wantsApprover = context.policy.autoApprove && verdict.outcome === 'within_policy'
  const approver = wantsApprover
    ? await resolveApprover(container, review.pullRequest.provider)
    : null
  const step = planApproval({
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
  if (step.kind === 'ai_review') return fileAiReview(container, review)
  // `planApproval` approves only with an approver in hand.
  return approve(container, assessed, approver as Approver)
}

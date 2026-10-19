import type {
  PullRequestStatus,
  RiskPolicy,
  RiskVerdict,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'
import type { AiReviewJudgement } from './aiReviewGate.js'

/** What to do next with an assessed pull request. */
export type ApprovalStep =
  | { kind: 'approve' }
  | { kind: 'ai_review' }
  | { kind: 'reassess' }
  | { kind: 'hold'; status: 'within_policy' | 'requires_review'; reason: string | null }

export interface ApprovalContext {
  provider: VcsProvider
  policy: RiskPolicy
  verdict: RiskVerdict
  /** The commit the verdict is about. */
  assessedHeadSha: string
  pullRequest: Pick<PullRequestStatus, 'state' | 'draft' | 'headSha' | 'authorLogin'>
  /**
   * Whether this org holds the claim on the repository. An approval of a pull
   * request in a repository another org registered, or nobody did, is never ours.
   */
  repositoryHeld: boolean
  /** The account approvals go out as, or null when the org has none on this host. */
  approver: { username: string | null } | null
  /** The AI review the policy asked for, judged once it has settled; null before. */
  aiReview: AiReviewJudgement | null
}

function hold(status: 'within_policy' | 'requires_review', reason: string | null): ApprovalStep {
  return { kind: 'hold', status, reason }
}

/** Why an otherwise eligible pull request cannot be approved right now, or null. */
function blocker(context: ApprovalContext): string | null {
  const { pullRequest, approver, provider } = context
  if (pullRequest.state !== 'open') return 'the pull request is no longer open'
  if (pullRequest.draft) return 'the pull request is a draft'
  if (!context.repositoryHeld) return 'its repository is not registered to this org'
  if (approver === null) {
    return `no approver is configured for ${vcsDisplayName(provider)}`
  }
  if (approver.username !== null && approver.username === pullRequest.authorLogin) {
    return 'the approver opened this pull request, and a host refuses an approval from its author'
  }
  return null
}

/**
 * The next step for a pull request that has a verdict. A head that moved since
 * the verdict is assessed again first, because the verdict was about other code.
 */
export function planApproval(context: ApprovalContext): ApprovalStep {
  const { policy, verdict } = context
  if (verdict.outcome === 'requires_review') return hold('requires_review', null)
  if (!policy.autoApprove) return hold('within_policy', 'automatic approval is off')
  if (context.pullRequest.headSha !== context.assessedHeadSha) return { kind: 'reassess' }
  const reason = blocker(context)
  if (reason !== null) return hold('within_policy', reason)
  if (!policy.requireAiReview) return { kind: 'approve' }
  if (context.aiReview === null) return { kind: 'ai_review' }
  return context.aiReview.outcome === 'clean'
    ? { kind: 'approve' }
    : hold('requires_review', context.aiReview.reason)
}

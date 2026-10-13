import type {
  AiReviewCuration,
  AiReviewFinding,
  AiReviewRun,
  AiReviewSeverity,
  PullRequestStatus,
  RiskPolicy,
  RiskVerdict,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'

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
  /** The account approvals go out as, or null when the org has none on this host. */
  approver: { username: string | null } | null
  /** The AI review the policy asked for, once it has settled on findings; null before. */
  aiReview: 'clean' | 'blocked' | null
}

function hold(status: 'within_policy' | 'requires_review', reason: string | null): ApprovalStep {
  return { kind: 'hold', status, reason }
}

/** Why an otherwise eligible pull request cannot be approved right now, or null. */
function blocker(context: ApprovalContext): string | null {
  const { pullRequest, approver, provider } = context
  if (pullRequest.state !== 'open') return 'the pull request is no longer open'
  if (pullRequest.draft) return 'the pull request is a draft'
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
  return context.aiReview === 'clean'
    ? { kind: 'approve' }
    : hold('requires_review', 'the AI review found something a person should look at')
}

const SEVERITY_RANK: Record<AiReviewSeverity, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
  nit: 0,
}

function blocks(finding: AiReviewFinding, threshold: AiReviewSeverity): boolean {
  if (finding.challenge?.status === 'retracted') return false
  return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold]
}

/** The findings that hold a pull request for a person under this threshold. */
export function blockingFindings(
  curation: AiReviewCuration | null,
  threshold: AiReviewSeverity,
): AiReviewFinding[] {
  return (curation?.findings ?? []).filter((finding) => blocks(finding, threshold))
}

/**
 * What an AI review run means for approval: null while it is still working,
 * `clean` when it settled with nothing at the threshold, `blocked` otherwise.
 * A run that failed or was cancelled blocks, since nobody vouched for the code.
 */
export function aiReviewOutcome(
  run: Pick<AiReviewRun, 'status' | 'curation'>,
  threshold: AiReviewSeverity,
): 'clean' | 'blocked' | null {
  if (run.status === 'failed' || run.status === 'cancelled') return 'blocked'
  if (run.status === 'completed') return 'clean'
  if (run.status !== 'awaiting_selection' || run.curation?.status !== 'awaiting_selection') {
    return null
  }
  return blockingFindings(run.curation, threshold).length === 0 ? 'clean' : 'blocked'
}

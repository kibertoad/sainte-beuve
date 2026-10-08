import type {
  Mergeability,
  PullRequestApproval,
  PullRequestState,
  PullRequestStatus,
} from '@sainte-beuve/contracts'

/** The fields of a single merge request read that the status and the merge need. */
export interface GitLabMergeRequestDetail {
  state: 'opened' | 'closed' | 'merged' | 'locked'
  web_url: string
  sha: string
  draft?: boolean
  work_in_progress?: boolean
  author?: { username: string } | null
  /** GitLab 15.6 and later. */
  detailed_merge_status?: string
  /** The older, coarser field, for an install that predates the detailed one. */
  merge_status?: string
  /** What the merge request will do on merge, which the merge passes back. */
  squash?: boolean
  squash_on_merge?: boolean
}

export interface GitLabApprovals {
  approved?: boolean
  approved_by?: unknown[] | null
}

export function toPullRequestStatus(
  merge: GitLabMergeRequestDetail,
  approvals: GitLabApprovals,
): PullRequestStatus {
  const draft = merge.draft ?? merge.work_in_progress ?? false
  return {
    state: stateOf(merge),
    url: merge.web_url,
    authorLogin: merge.author?.username ?? '',
    draft,
    approval: approvalOf(approvals),
    mergeability: draft ? 'draft' : mergeabilityOf(merge),
    headSha: merge.sha,
  }
}

function stateOf(merge: GitLabMergeRequestDetail): PullRequestState {
  if (merge.state === 'merged') return 'merged'
  return merge.state === 'closed' ? 'closed' : 'open'
}

/**
 * Approved once somebody approved and no required approval is left. `approved`
 * alone is true on a project that requires none, before anybody has looked.
 */
export function approvalOf(approvals: GitLabApprovals): PullRequestApproval {
  const approvers = approvals.approved_by?.length ?? 0
  return approvers > 0 && approvals.approved !== false ? 'approved' : 'pending'
}

const CHECKING = new Set(['checking', 'unchecked', 'preparing', 'approvals_syncing'])

/** Every detailed status other than these names a rule that blocks the merge. */
export function mergeabilityOf(merge: GitLabMergeRequestDetail): Mergeability {
  const detailed = merge.detailed_merge_status
  if (detailed !== undefined) {
    if (detailed === 'mergeable') return 'mergeable'
    if (detailed === 'conflict') return 'conflicting'
    if (detailed === 'draft_status') return 'draft'
    return CHECKING.has(detailed) ? 'checking' : 'blocked'
  }
  if (merge.merge_status === 'can_be_merged') return 'mergeable'
  if (merge.merge_status === 'cannot_be_merged') return 'conflicting'
  return 'checking'
}

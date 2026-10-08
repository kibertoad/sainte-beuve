import type {
  Mergeability,
  PullRequestApproval,
  PullRequestState,
  PullRequestStatus,
} from '@sainte-beuve/contracts'

/** The fields of a single pull request read that the status needs. */
export interface GitHubPullRequestDetail {
  state: 'open' | 'closed'
  html_url: string
  merged?: boolean
  draft?: boolean
  user?: { login: string } | null
  /** Null while GitHub is still computing it in the background. */
  mergeable?: boolean | null
  mergeable_state?: string
  head: { sha: string }
}

export interface GitHubReview {
  user?: { login: string } | null
  state: string
}

export interface GitHubRepositorySettings {
  allow_merge_commit?: boolean
  allow_squash_merge?: boolean
  allow_rebase_merge?: boolean
}

export type GitHubMergeMethod = 'merge' | 'squash' | 'rebase'

export function toPullRequestStatus(
  pull: GitHubPullRequestDetail,
  reviews: readonly GitHubReview[],
): PullRequestStatus {
  return {
    state: stateOf(pull),
    url: pull.html_url,
    authorLogin: pull.user?.login ?? '',
    draft: pull.draft ?? false,
    approval: approvalOf(reviews),
    mergeability: mergeabilityOf(pull),
    headSha: pull.head.sha,
  }
}

function stateOf(pull: GitHubPullRequestDetail): PullRequestState {
  if (pull.merged === true) return 'merged'
  return pull.state === 'open' ? 'open' : 'closed'
}

/**
 * Each reviewer's latest verdict counts, as on the pull request page: a later
 * approval replaces an earlier change request, and a dismissal clears both.
 * Plain comments are not verdicts and change nothing.
 */
export function approvalOf(reviews: readonly GitHubReview[]): PullRequestApproval {
  const latest = new Map<string, string>()
  for (const review of reviews) {
    const login = review.user?.login
    if (login === undefined) continue
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
      latest.set(login, review.state)
    } else if (review.state === 'DISMISSED') {
      latest.delete(login)
    }
  }
  const verdicts = [...latest.values()]
  if (verdicts.includes('CHANGES_REQUESTED')) return 'changes_requested'
  return verdicts.includes('APPROVED') ? 'approved' : 'pending'
}

/**
 * `unstable` is mergeable: it means a check that is not required failed.
 * `behind` and `blocked` are both branch protection saying no.
 */
export function mergeabilityOf(pull: GitHubPullRequestDetail): Mergeability {
  if (pull.draft === true || pull.mergeable_state === 'draft') return 'draft'
  switch (pull.mergeable_state) {
    case 'clean':
    case 'has_hooks':
    case 'unstable':
      return 'mergeable'
    case 'dirty':
      return 'conflicting'
    case 'blocked':
    case 'behind':
      return 'blocked'
    default:
      return pull.mergeable === false ? 'conflicting' : 'checking'
  }
}

/** The first method the repository allows, in the order GitHub's own merge button offers them. */
export function mergeMethodOf(settings: GitHubRepositorySettings): GitHubMergeMethod {
  if (settings.allow_merge_commit !== false) return 'merge'
  if (settings.allow_squash_merge !== false) return 'squash'
  return 'rebase'
}

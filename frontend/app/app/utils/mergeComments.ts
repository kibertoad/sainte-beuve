import type { MergeComment, MyPullRequest } from '@sainte-beuve/contracts'
import { MAX_MERGE_COMMENT_LABEL } from '@sainte-beuve/contracts'

/**
 * A list as it should be saved: fields trimmed, a row left entirely blank dropped,
 * and a row with no label named after the comment it posts.
 */
export function cleanMergeComments(comments: MergeComment[] | null): MergeComment[] | null {
  if (comments === null) return null
  return comments
    .map((comment) => {
      const body = comment.body.trim()
      return { label: comment.label.trim() || defaultMergeCommentLabel(body), body }
    })
    .filter((comment) => comment.label.length > 0 || comment.body.length > 0)
}

/** The button label a row gets when it is left without one. */
export function defaultMergeCommentLabel(body: string): string {
  return body.trim().slice(0, MAX_MERGE_COMMENT_LABEL).trim()
}

export function sameMergeComments(
  left: MergeComment[] | null,
  right: MergeComment[] | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** What a row says about its merge state, in the words a person reads on the host. */
export function mergeStateLabel(pr: MyPullRequest): { label: string; color: BadgeColor } {
  const status = pr.status
  if (status === null) return { label: 'Status unknown', color: 'warning' }
  if (status.approval === 'changes_requested') return { label: 'Changes requested', color: 'error' }
  switch (status.mergeability) {
    case 'mergeable':
      return { label: 'Ready to merge', color: 'success' }
    case 'conflicting':
      return { label: 'Has conflicts', color: 'error' }
    case 'checking':
      return { label: 'Checking', color: 'neutral' }
    case 'draft':
      return { label: 'Draft', color: 'neutral' }
    default:
      return { label: 'Blocked', color: 'warning' }
  }
}

type BadgeColor = 'success' | 'error' | 'warning' | 'neutral'

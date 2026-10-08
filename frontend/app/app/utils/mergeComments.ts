import type { MergeComment, MyPullRequest } from '@sainte-beuve/contracts'

/** A list as it should be saved: fields trimmed, and a row left entirely blank dropped. */
export function cleanMergeComments(comments: MergeComment[] | null): MergeComment[] | null {
  if (comments === null) return null
  return comments
    .map((comment) => ({ label: comment.label.trim(), body: comment.body.trim() }))
    .filter((comment) => comment.label.length > 0 || comment.body.length > 0)
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

import type { ChangedFile, PullRequestAddress } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { githubRequest, repoPath } from './client.js'

/** How a GitHub call is authenticated and where it goes. */
export interface GitHubCallContext {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

const FILES_PER_PAGE = 100

/** GitHub lists at most 3000 files of one pull request, thirty pages of a hundred. */
const MAX_FILE_PAGES = 30

interface GitHubChangedFile {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
}

function statusOf(status: string): ChangedFile['status'] {
  if (status === 'added' || status === 'removed' || status === 'renamed') return status
  return 'modified'
}

export async function githubChangedFiles(
  pr: PullRequestAddress,
  context: GitHubCallContext,
): Promise<{ files: ChangedFile[]; truncated: boolean }> {
  const files: ChangedFile[] = []
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const batch = await githubRequest<GitHubChangedFile[]>({
      ...context,
      path: repoPath(pr, `/pulls/${pr.number}/files?per_page=${FILES_PER_PAGE}&page=${page}`),
    })
    for (const file of batch) {
      files.push({
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        status: statusOf(file.status),
        additions: file.additions,
        deletions: file.deletions,
      })
    }
    if (batch.length < FILES_PER_PAGE) return { files, truncated: false }
  }
  return { files, truncated: true }
}

/**
 * Submit an APPROVE review pinned to `headSha`. GitHub would accept an approval
 * of an older commit, so the head is compared first: approving code nobody
 * assessed is the one outcome this must never have.
 */
export async function githubApprove(
  pr: PullRequestAddress,
  input: { headSha: string; body: string },
  context: GitHubCallContext,
): Promise<{ approvalId: string | null }> {
  const pull = await githubRequest<{ head: { sha: string } }>({
    ...context,
    path: repoPath(pr, `/pulls/${pr.number}`),
  })
  if (pull.head.sha !== input.headSha) {
    throw new ConflictError(`The pull request moved to ${pull.head.sha} after it was assessed`)
  }
  const review = await githubRequest<{ id: number }>({
    ...context,
    method: 'POST',
    path: repoPath(pr, `/pulls/${pr.number}/reviews`),
    body: { commit_id: input.headSha, event: 'APPROVE', body: input.body },
  })
  return { approvalId: String(review.id) }
}

/** Dismiss the approval by its review id. One with no id has nothing to dismiss. */
export async function githubWithdrawApproval(
  pr: PullRequestAddress,
  input: { approvalId: string | null; message: string },
  context: GitHubCallContext,
): Promise<void> {
  if (input.approvalId === null) return
  await githubRequest({
    ...context,
    method: 'PUT',
    path: repoPath(pr, `/pulls/${pr.number}/reviews/${input.approvalId}/dismissals`),
    body: { message: input.message, event: 'DISMISS' },
  })
}

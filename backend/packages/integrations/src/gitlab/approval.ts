import type { ChangedFile, PullRequestAddress } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { gitlabApiStatusOf, gitlabRequest, projectPath } from './client.js'

/** How a GitLab call is authenticated and where it goes. */
export interface GitLabCallContext {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

const DIFFS_PER_PAGE = 100

/** The same ceiling GitHub puts on one pull request's files. */
const MAX_DIFF_PAGES = 30

interface GitLabDiff {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff?: string
}

function mergeRequestPath(pr: PullRequestAddress): string {
  return `/projects/${projectPath(pr.owner, pr.repo)}/merge_requests/${pr.number}`
}

function statusOf(diff: GitLabDiff): ChangedFile['status'] {
  if (diff.new_file) return 'added'
  if (diff.deleted_file) return 'removed'
  return diff.renamed_file ? 'renamed' : 'modified'
}

/** GitLab gives the patch rather than counts, so the lines are counted off it. */
function countLines(patch: string | undefined): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of (patch ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

function toChangedFile(diff: GitLabDiff): ChangedFile {
  return {
    path: diff.new_path,
    previousPath: diff.renamed_file ? diff.old_path : null,
    status: statusOf(diff),
    ...countLines(diff.diff),
  }
}

export async function gitlabChangedFiles(
  pr: PullRequestAddress,
  context: GitLabCallContext,
): Promise<{ files: ChangedFile[]; truncated: boolean }> {
  const files: ChangedFile[] = []
  for (let page = 1; page <= MAX_DIFF_PAGES; page += 1) {
    const batch = await gitlabRequest<GitLabDiff[]>({
      ...context,
      path: `${mergeRequestPath(pr)}/diffs?per_page=${DIFFS_PER_PAGE}&page=${page}`,
    })
    files.push(...batch.map(toChangedFile))
    if (batch.length < DIFFS_PER_PAGE) return { files, truncated: false }
  }
  return { files, truncated: true }
}

/**
 * Approve at `headSha`, which GitLab itself refuses with a 409 when the source
 * branch has moved. The body goes up as a note beside the approval, since an
 * approval on GitLab carries no text.
 */
export async function gitlabApprove(
  pr: PullRequestAddress,
  input: { headSha: string; body: string },
  context: GitLabCallContext,
): Promise<{ approvalId: string | null }> {
  try {
    await gitlabRequest({
      ...context,
      method: 'POST',
      path: `${mergeRequestPath(pr)}/approve`,
      body: { sha: input.headSha },
    })
  } catch (err) {
    if (gitlabApiStatusOf(err) === 409 && err instanceof Error) throw new ConflictError(err.message)
    throw err
  }
  await gitlabRequest({
    ...context,
    method: 'POST',
    path: `${mergeRequestPath(pr)}/notes`,
    body: { body: input.body },
  })
  return { approvalId: null }
}

/** GitLab keeps one approval per account, so the token's own is the one taken back. */
export async function gitlabWithdrawApproval(
  pr: PullRequestAddress,
  input: { message: string },
  context: GitLabCallContext,
): Promise<void> {
  await gitlabRequest({ ...context, method: 'POST', path: `${mergeRequestPath(pr)}/unapprove` })
  await gitlabRequest({
    ...context,
    method: 'POST',
    path: `${mergeRequestPath(pr)}/notes`,
    body: { body: input.message },
  })
}

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
  too_large?: boolean
  collapsed?: boolean
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

/**
 * GitLab leaves the patch out of a diff it judged too large, so its lines cannot
 * be counted. A rename with no edits is the one change with an honest empty patch.
 */
function unreadable(diff: GitLabDiff): boolean {
  if (diff.too_large === true || diff.collapsed === true) return true
  return (diff.diff ?? '') === '' && !diff.renamed_file
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
  let unread = false
  for (let page = 1; page <= MAX_DIFF_PAGES; page += 1) {
    const batch = await gitlabRequest<GitLabDiff[]>({
      ...context,
      path: `${mergeRequestPath(pr)}/diffs?per_page=${DIFFS_PER_PAGE}&page=${page}`,
    })
    files.push(...batch.map(toChangedFile))
    unread ||= batch.some(unreadable)
    if (batch.length < DIFFS_PER_PAGE) return { files, truncated: unread }
  }
  return { files, truncated: true }
}

/**
 * Approve at `headSha`, which GitLab itself refuses with a 409 when the source
 * branch has moved. A GitLab approval carries no text, so the body is left to
 * the caller to post as a note.
 */
export async function gitlabApprove(
  pr: PullRequestAddress,
  input: { headSha: string },
  context: GitLabCallContext,
): Promise<{ approvalId: string | null; bodyPosted: boolean }> {
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
  return { approvalId: null, bodyPosted: false }
}

/**
 * GitLab keeps one approval per account, so the token's own is the one taken
 * back. An unapproval carries no text either, so the message is the caller's.
 */
export async function gitlabWithdrawApproval(
  pr: PullRequestAddress,
  context: GitLabCallContext,
): Promise<{ messagePosted: boolean }> {
  await gitlabRequest({ ...context, method: 'POST', path: `${mergeRequestPath(pr)}/unapprove` })
  return { messagePosted: false }
}

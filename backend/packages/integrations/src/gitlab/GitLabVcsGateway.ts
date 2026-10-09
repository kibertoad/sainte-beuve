import type {
  OpenPullRequest,
  ProjectRef,
  PullRequestRef,
  PullRequestStatus,
} from '@sainte-beuve/contracts'
import type {
  PullRequestAddress,
  PullRequestSearch,
  PullRequestSearchRole,
  VcsAccount,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { gitlabApiStatusOf, gitlabRequest, projectPath } from './client.js'
import {
  type GitLabApprovals,
  type GitLabMergeRequestDetail,
  toPullRequestStatus,
} from './merging.js'

/**
 * The GitLab side of the VCS port.
 *
 * Everything a merge request is called on GitLab is translated HERE, at the
 * adapter's own edge: an `iid` becomes a number, a reviewer id becomes a
 * handle, and a project path becomes one URL-encoded segment. Nothing above
 * this file carries a branch on which host a project is on, which is the whole
 * point of the port.
 *
 * Authentication is one token, unlike GitHub's: GitLab has no App concept, so a
 * group access token is a pasted token like any other and there is nothing to
 * mint per project.
 */

/** How many merge requests one page of a workspace read pulls. GitLab's own cap. */
const PAGE_SIZE = 100

/**
 * How many pages one read will follow. A project with more than a thousand open
 * merge requests is past what any screen is read down, and the cap is what
 * keeps one badly registered project from spending a rate-limit budget.
 */
const MAX_PAGES = 10

/**
 * What GitLab answers a merge it will not make with: 405 or 406 for one it
 * cannot merge, 409 for a head that moved, 422 for one it refuses outright.
 */
const MERGE_REFUSALS = new Set([405, 406, 409, 422])

/**
 * GitLab keeps no record of who reviewed a merge request short of approving it,
 * so `reviewed` means approved. It also names the person as a reviewer: on an
 * install that ignores the approver filter, the list then narrows to what is
 * already under `review_requested` rather than widening to every merge request.
 */
const SEARCH_FILTERS: Record<PullRequestSearchRole, (username: string) => string> = {
  authored: (username) => `author_username=${username}`,
  review_requested: (username) => `reviewer_username=${username}`,
  reviewed: (username) =>
    `approved_by_usernames[]=${username}&reviewer_username=${username}&not[author_username]=${username}`,
}

interface GitLabUser {
  id: number
  username: string
  name?: string | null
  avatar_url?: string | null
}

interface GitLabMergeRequest {
  iid: number
  title: string
  web_url: string
  draft?: boolean
  work_in_progress?: boolean
  created_at: string
  updated_at: string
  author?: GitLabUser | null
  reviewers?: GitLabUser[] | null
  /** `group/sub/project!12`, which is the only place a listing names the project by path. */
  references?: { full?: string } | null
}

export interface GitLabGatewayOptions {
  /** A personal or group access token, or the token a sign-in produced. */
  token: string
  /** The install's root, e.g. `https://gitlab.example.com`. Defaults to gitlab.com. */
  baseUrl?: string
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}

export class GitLabVcsGateway implements VcsGateway {
  private readonly options: GitLabGatewayOptions
  /** Memoised for the life of this gateway, so repeated reads cost one round trip. */
  private identity?: Promise<VcsAccount | null>

  constructor(options: GitLabGatewayOptions) {
    this.options = options
  }

  /**
   * PAGED, because `per_page` stops at 100: a project with more open merge
   * requests would otherwise drop the viewer's own older one off the workspace
   * while the screen reported the project as read, which states positively that
   * there is nothing there.
   */
  async listOpenPullRequests(project: ProjectRef): Promise<OpenPullRequest[]> {
    const merges: GitLabMergeRequest[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await this.call<GitLabMergeRequest[]>({
        path:
          `/projects/${projectPath(project.owner, project.repo)}/merge_requests` +
          `?state=opened&per_page=${PAGE_SIZE}&page=${page}&order_by=updated_at&sort=desc`,
      })
      merges.push(...batch)
      // A short page is the last page, so there is no request spent finding out.
      if (batch.length < PAGE_SIZE) break
    }
    return merges.map((merge) => this.toOpenPullRequest(project, merge))
  }

  /** One page of the instance-wide list, which `scope=all` opens past the token's own. */
  async searchOpenPullRequests(search: PullRequestSearch): Promise<OpenPullRequest[]> {
    const merges = await this.call<GitLabMergeRequest[]>({
      path:
        `/merge_requests?state=opened&scope=all&${SEARCH_FILTERS[search.role](encodeURIComponent(search.username))}` +
        `&per_page=${PAGE_SIZE}&order_by=updated_at&sort=desc`,
    })
    return merges.flatMap((merge) => {
      const project = projectOf(merge)
      return project === null ? [] : [this.toOpenPullRequest(project, merge)]
    })
  }

  /** Two reads, because the approvals are their own resource on GitLab. */
  async pullRequestStatus(pr: PullRequestAddress): Promise<PullRequestStatus> {
    const [merge, approvals] = await Promise.all([
      this.call<GitLabMergeRequestDetail>({ path: mergeRequestPath(pr) }),
      this.call<GitLabApprovals>({ path: `${mergeRequestPath(pr)}/approvals` }),
    ])
    return toPullRequestStatus(merge, approvals)
  }

  /**
   * The project's own merge method applies, since GitLab sets it per project.
   * Squashing is per merge request, so its setting is read and passed back.
   */
  async merge(pr: PullRequestAddress, expectedHeadSha: string): Promise<void> {
    const merge = await this.call<GitLabMergeRequestDetail>({ path: mergeRequestPath(pr) })
    try {
      await this.call({
        method: 'PUT',
        path: `${mergeRequestPath(pr)}/merge`,
        body: { sha: expectedHeadSha, squash: merge.squash_on_merge ?? merge.squash ?? false },
      })
    } catch (err) {
      const status = gitlabApiStatusOf(err)
      if (status !== undefined && MERGE_REFUSALS.has(status) && err instanceof Error) {
        throw new ConflictError(err.message)
      }
      throw err
    }
  }

  async requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    await this.changeReviewers(pr, (current, named) => union(current, named), logins)
  }

  async removeRequestedReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    await this.changeReviewers(pr, (current, named) => difference(current, named), logins)
  }

  async comment(pr: PullRequestRef, body: string): Promise<void> {
    await this.call({
      method: 'POST',
      path: `/projects/${projectPath(pr.owner, pr.repo)}/merge_requests/${pr.number}/notes`,
      body: { body },
    })
  }

  async identify(): Promise<VcsAccount | null> {
    // A FAILED read is not memoised: a rejected promise left in the field would
    // answer every later call with the same rate limit or the same expired
    // token, so a screen that polls could never recover without a redeploy.
    this.identity ??= this.readViewer().catch((err: unknown) => {
      this.identity = undefined
      throw err
    })
    return this.identity
  }

  /**
   * Rewrite the reviewer list. GitLab has no add/remove endpoint: the update
   * REPLACES `reviewer_ids` wholesale, so the current list has to be read and
   * merged, or a reroll would silently drop everybody the update did not name.
   */
  private async changeReviewers(
    pr: PullRequestRef,
    combine: (current: number[], named: number[]) => number[],
    logins: string[],
  ): Promise<void> {
    const path = `/projects/${projectPath(pr.owner, pr.repo)}/merge_requests/${pr.number}`
    const merge = await this.call<GitLabMergeRequest>({ path })
    const current = (merge.reviewers ?? []).map((user) => user.id)
    const named = await this.userIds(logins)
    const next = combine(current, named)
    if (sameSet(current, next)) return
    await this.call({ method: 'PUT', path, body: { reviewer_ids: next } })
  }

  /**
   * Handles to numeric ids, which is the only thing the update accepts. A
   * handle GitLab does not know is DROPPED rather than failing the call: a
   * reviewer registered here who has no account on this install must not stop
   * the ones who do from being requested.
   */
  private async userIds(logins: string[]): Promise<number[]> {
    const found = await Promise.all(logins.map((login) => this.userId(login)))
    return found.filter((id): id is number => id !== null)
  }

  private async userId(login: string): Promise<number | null> {
    const users = await this.call<GitLabUser[]>({
      path: `/users?username=${encodeURIComponent(login)}`,
    })
    return users[0]?.id ?? null
  }

  private async readViewer(): Promise<VcsAccount | null> {
    const user = await this.call<GitLabUser>({ path: '/user' })
    return toAccount(user)
  }

  private toOpenPullRequest(project: ProjectRef, merge: GitLabMergeRequest): OpenPullRequest {
    return {
      pullRequest: {
        provider: 'gitlab',
        owner: project.owner,
        repo: project.repo,
        number: merge.iid,
        url: merge.web_url,
      },
      title: merge.title,
      authorLogin: merge.author?.username ?? '',
      requestedReviewerLogins: (merge.reviewers ?? []).map((user) => user.username),
      // `draft` on current GitLab, `work_in_progress` on an older install. Both
      // are the same flag, and an install that answers neither has no drafts.
      draft: merge.draft ?? merge.work_in_progress ?? false,
      createdAt: Date.parse(merge.created_at),
      updatedAt: Date.parse(merge.updated_at),
    }
  }

  private async call<T>(request: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    path: string
    body?: unknown
  }): Promise<T> {
    return gitlabRequest<T>({
      ...request,
      token: this.options.token,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
  }
}

function mergeRequestPath(pr: PullRequestAddress): string {
  return `/projects/${projectPath(pr.owner, pr.repo)}/merge_requests/${pr.number}`
}

/** The last path segment is the repo and the rest is the namespace, however deep it nests. */
function projectOf(merge: GitLabMergeRequest): ProjectRef | null {
  const path = merge.references?.full?.split('!')[0] ?? ''
  const slash = path.lastIndexOf('/')
  if (slash <= 0 || slash === path.length - 1) return null
  return { provider: 'gitlab', owner: path.slice(0, slash), repo: path.slice(slash + 1) }
}

function toAccount(user: GitLabUser): VcsAccount {
  return {
    subject: String(user.id),
    username: user.username,
    displayName: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
  }
}

function union(current: number[], named: number[]): number[] {
  return [...new Set([...current, ...named])]
}

function difference(current: number[], named: number[]): number[] {
  const drop = new Set(named)
  return current.filter((id) => !drop.has(id))
}

/** Whether the update would change anything, so a no-op costs no write. */
function sameSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false
  const seen = new Set(left)
  return right.every((id) => seen.has(id))
}

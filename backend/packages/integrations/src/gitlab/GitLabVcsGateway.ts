import type { OpenPullRequest, ProjectRef, PullRequestRef } from '@sainte-beuve/contracts'
import type { VcsAccount, VcsGateway } from '@sainte-beuve/kernel'
import { gitlabRequest, projectPath } from './client.js'

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

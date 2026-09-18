import type { OpenPullRequest, ProjectRef, PullRequestRef } from '@sainte-beuve/contracts'
import type { VcsAccount, VcsGateway } from '@sainte-beuve/kernel'
import { githubRequest, repoPath } from './client.js'
import type { GitHubTokenSource } from './credentials.js'

/**
 * The GitHub side of the VCS port: mirror an assignment onto the pull request,
 * and post comments.
 *
 * Mirroring matters more than it looks. sainte-beuve picks the reviewer, but
 * GitHub is where the reviewer gets their notification and where the PR page
 * shows who is on the hook, so an assignment that lives only in our store is an
 * assignment half the team never sees.
 *
 * Authentication is a {@link GitHubTokenSource}, so the same gateway serves all
 * three ways a deployment can be connected: a personal access token, the token a
 * "Sign in with GitHub" produced, or an App installation token minted per
 * repository. Which one a deployment uses is resolved above this line; nothing
 * here knows or cares.
 */

/** How many pull requests one page of a workspace read pulls. GitHub's own cap. */
const PAGE_SIZE = 100

/**
 * How many pages one read will follow. A repository with more than a thousand
 * open pull requests is past what any screen is read down, and the cap is what
 * keeps one badly registered project from spending a rate-limit budget.
 */
const MAX_PAGES = 10

interface GitHubUser {
  id: number
  login: string
  name?: string | null
  avatar_url?: string | null
}

interface GitHubPullRequest {
  number: number
  title: string
  html_url: string
  draft?: boolean
  created_at: string
  updated_at: string
  user?: GitHubUser | null
  requested_reviewers?: GitHubUser[] | null
}

export interface GitHubGatewayOptions {
  /** How to authenticate. `staticTokenSource(token)` covers a plain token. */
  tokens: GitHubTokenSource
  /** Override for GitHub Enterprise Server. Defaults to github.com. */
  baseUrl?: string
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}

export class GitHubVcsGateway implements VcsGateway {
  private readonly options: GitHubGatewayOptions
  /** Memoised for the life of this gateway, so repeated reads cost one round trip. */
  private identity?: Promise<VcsAccount | null>

  constructor(options: GitHubGatewayOptions) {
    this.options = options
  }

  /**
   * The repository's open pull requests, newest activity first.
   *
   * The LIST endpoint rather than the search API, which could filter by author
   * server-side. Search is eventually consistent (a pull request opened seconds
   * ago is missing from it), it carries its own much smaller rate limit, and it
   * would take one query per role where this takes one per repository and
   * answers both.
   *
   * PAGED, because `per_page` stops at 100: a monorepo with more open pull
   * requests would otherwise drop the viewer's own older one off the workspace
   * while the screen reported the project as read, which states positively that
   * there is nothing there.
   */
  async listOpenPullRequests(project: ProjectRef): Promise<OpenPullRequest[]> {
    const token = await this.options.tokens.tokenFor(project.owner, project.repo)
    const pulls: GitHubPullRequest[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await githubRequest<GitHubPullRequest[]>({
        path: repoPath(
          project,
          `/pulls?state=open&per_page=${PAGE_SIZE}&page=${page}&sort=updated&direction=desc`,
        ),
        token,
        baseUrl: this.options.baseUrl,
        fetchImpl: this.options.fetchImpl,
      })
      pulls.push(...batch)
      // A short page is the last page, so there is no request spent finding out.
      if (batch.length < PAGE_SIZE) break
    }
    return pulls.map((pull) => toOpenPullRequest(project, pull))
  }

  async requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    await this.call(pr, {
      method: 'POST',
      path: repoPath(pr, `/pulls/${pr.number}/requested_reviewers`),
      body: { reviewers: logins },
    })
  }

  async removeRequestedReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    await this.call(pr, {
      method: 'DELETE',
      // Same path as the request, minus the reviewers named in the body. GitHub
      // answers 200 whether or not they were requested, so a reroll on a pull
      // request nobody was requested on is not a failure.
      path: repoPath(pr, `/pulls/${pr.number}/requested_reviewers`),
      body: { reviewers: logins },
    })
  }

  async comment(pr: PullRequestRef, body: string): Promise<void> {
    await this.call(pr, {
      method: 'POST',
      // A pull request IS an issue for the comments API; `issue_number` is the PR number.
      path: repoPath(pr, `/issues/${pr.number}/comments`),
      body: { body },
    })
  }

  /**
   * Who this credential acts as, or null when it acts as no person. An App
   * installation token is the null case, and it is answered WITHOUT a request:
   * `GET /user` under an installation token is a 403, which would otherwise be
   * reported to an operator as a broken connection.
   */
  async identify(): Promise<VcsAccount | null> {
    if (!this.options.tokens.hasUser) return null
    // A FAILED read is not memoised: a rejected promise left in the field would
    // answer every later call with the same rate limit or the same expired
    // token, so a screen that polls could never recover without a redeploy.
    this.identity ??= this.readViewer().catch((err: unknown) => {
      this.identity = undefined
      throw err
    })
    return this.identity
  }

  private async readViewer(): Promise<VcsAccount | null> {
    // No repository in play, so the source is asked for its unscoped token. A
    // static source ignores both arguments; an App source never reaches here.
    const token = await this.options.tokens.tokenFor('', '')
    const user = await githubRequest<GitHubUser>({
      path: '/user',
      token,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
    return {
      subject: String(user.id),
      username: user.login,
      displayName: user.name ?? null,
      avatarUrl: user.avatar_url ?? null,
    }
  }

  private async call(
    pr: PullRequestRef,
    request: { method: 'POST' | 'DELETE'; path: string; body: unknown },
  ): Promise<void> {
    await githubRequest({
      ...request,
      token: await this.options.tokens.tokenFor(pr.owner, pr.repo),
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
  }
}

function toOpenPullRequest(project: ProjectRef, pull: GitHubPullRequest): OpenPullRequest {
  return {
    pullRequest: {
      provider: 'github',
      owner: project.owner,
      repo: project.repo,
      number: pull.number,
      url: pull.html_url,
    },
    title: pull.title,
    authorLogin: pull.user?.login ?? '',
    requestedReviewerLogins: (pull.requested_reviewers ?? []).map((user) => user.login),
    draft: pull.draft ?? false,
    createdAt: Date.parse(pull.created_at),
    updatedAt: Date.parse(pull.updated_at),
  }
}

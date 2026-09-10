import type { PullRequestRef } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import { githubRequest } from './client.js'
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
  /** Memoised, because `identify()` is read by a status screen that polls. */
  private identity?: Promise<string | null>

  constructor(options: GitHubGatewayOptions) {
    this.options = options
  }

  async requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    await this.call(pr, {
      method: 'POST',
      path: `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/requested_reviewers`,
      body: { reviewers: logins },
    })
  }

  async comment(pr: PullRequestRef, body: string): Promise<void> {
    await this.call(pr, {
      method: 'POST',
      // A pull request IS an issue for the comments API; `issue_number` is the PR number.
      path: `/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
      body: { body },
    })
  }

  /**
   * Who this credential acts as, or null when it acts as no person. An App
   * installation token is the null case, and it is answered WITHOUT a request:
   * `GET /user` under an installation token is a 403, which would otherwise be
   * reported to an operator as a broken connection.
   */
  async identify(): Promise<string | null> {
    if (!this.options.tokens.hasUser) return null
    this.identity ??= this.readViewer()
    return this.identity
  }

  private async readViewer(): Promise<string | null> {
    // No repository in play, so the source is asked for its unscoped token. A
    // static source ignores both arguments; an App source never reaches here.
    const token = await this.options.tokens.tokenFor('', '')
    const user = await githubRequest<{ login?: string }>({
      path: '/user',
      token,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
    return user.login ?? null
  }

  private async call(
    pr: PullRequestRef,
    request: { method: 'POST'; path: string; body: unknown },
  ): Promise<void> {
    await githubRequest({
      ...request,
      token: await this.options.tokens.tokenFor(pr.owner, pr.repo),
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
  }
}

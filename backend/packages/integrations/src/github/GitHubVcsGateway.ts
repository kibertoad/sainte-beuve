import type { PullRequestRef } from '@sainte-beuve/contracts'
import { UpstreamFailedError, type VcsGateway, getErrorMessage } from '@sainte-beuve/kernel'
import { Octokit } from 'octokit'

/**
 * The GitHub side of the VCS port: mirror an assignment onto the pull request and
 * post comments.
 *
 * Mirroring matters more than it looks. sainte-beuve picks the reviewer, but GitHub
 * is where the reviewer actually gets their notification and where the PR page shows
 * who is on the hook, so an assignment that lives only in our store is an assignment
 * half the team never sees.
 *
 * Authentication is a token today (a PAT locally, a GitHub App installation token in
 * a hosted deployment). The App path is the next slice: see
 * docs/implementation-plan.md.
 */
export interface GitHubGatewayOptions {
  token: string
  /** Override for GitHub Enterprise Server. Defaults to github.com. */
  baseUrl?: string
}

export class GitHubVcsGateway implements VcsGateway {
  private readonly octokit: Octokit

  constructor(options: GitHubGatewayOptions) {
    this.octokit = new Octokit({ auth: options.token, baseUrl: options.baseUrl })
  }

  async requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void> {
    if (logins.length === 0) return
    try {
      await this.octokit.rest.pulls.requestReviewers({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        reviewers: logins,
      })
    } catch (err) {
      throw new UpstreamFailedError(
        `GitHub refused the reviewer request for ${pr.owner}/${pr.repo}#${pr.number}: ${getErrorMessage(err)}`,
      )
    }
  }

  async comment(pr: PullRequestRef, body: string): Promise<void> {
    try {
      // A pull request IS an issue for the comments API; `issue_number` is the PR number.
      await this.octokit.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        body,
      })
    } catch (err) {
      throw new UpstreamFailedError(
        `GitHub refused the comment on ${pr.owner}/${pr.repo}#${pr.number}: ${getErrorMessage(err)}`,
      )
    }
  }
}

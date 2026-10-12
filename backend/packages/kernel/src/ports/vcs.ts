import type {
  OpenPullRequest,
  ProjectRef,
  PullRequestRef,
  PullRequestStatus,
  RepositoryLookup,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '../domain/types.js'

/** Source control: the port every host adapter implements, and what it answers with. */

/**
 * What a host search looks for: pull requests `username` opened, was asked to
 * review, or has reviewed. A reviewed one excludes the person's own.
 */
export type PullRequestSearchRole = 'authored' | 'review_requested' | 'reviewed'

export interface PullRequestSearch {
  username: string
  role: PullRequestSearchRole
}

/**
 * One account on a source-control host.
 *
 * The `subject` is what an identity is keyed on, and the `username` is not: a
 * handle is renameable and reusable by whoever claims it next, while both hosts
 * hand out a numeric id that never moves. A gateway that reported only the
 * handle would let a rename detach a person from their own workspace, and let
 * the next holder of the name inherit it.
 */
export interface VcsAccount {
  /** The host's stable id for the account, as a string. */
  subject: string
  /** The handle the host attributes pull requests to. */
  username: string
  displayName: string | null
  avatarUrl: string | null
}

/** How many of a project's pull requests one handle gave a verdict on. */
export interface ReviewerTally {
  login: string
  reviews: number
}

/** A pull request by the coordinates every host addresses it by. */
export type PullRequestAddress = ProjectRef & { number: number }

/**
 * Source control. One interface for every host: GitHub calls the objects pull
 * requests and GitLab calls them merge requests, and the translation happens
 * inside the adapter so that nothing above this line carries a branch on which
 * host a project is on.
 */
export interface VcsGateway {
  /**
   * Mirror the assignment onto the pull request, so the VCS stays the source of
   * truth. Answers the logins this call put a request on: one the host already
   * listed, or has no account for, is left out where the host can tell.
   */
  requestReviewers(pr: PullRequestRef, logins: string[]): Promise<string[]>
  /**
   * Take the review request back off people who are no longer on the hook. The
   * other half of `requestReviewers`: a reroll that only added the replacement
   * would leave the previous reviewer with a pending request on the pull request
   * and the notifications that come with it.
   */
  removeRequestedReviewers(pr: PullRequestRef, logins: string[]): Promise<void>
  /**
   * The handles the host is still waiting on a review from: requested, and not
   * answered yet. Somebody who has already reviewed is not in it, so a caller
   * that withdraws only from this list never takes back a request somebody has
   * acted on.
   */
  pendingReviewers(pr: PullRequestRef): Promise<string[]>
  /** Post a nudge or an AI-review verdict as a pull-request comment. */
  comment(pr: PullRequestRef, body: string): Promise<void>
  /**
   * Every open pull request in one project, with its author and the reviewers
   * the host has been asked for.
   *
   * One call answers both workspace lists. Both hosts return the author and the
   * requested reviewers on the same page, so asking once per role would double
   * the rate-limit cost of a workspace read to learn what the first answer
   * already held, and the two halves would be from different moments.
   */
  listOpenPullRequests(project: ProjectRef): Promise<OpenPullRequest[]>
  /**
   * The open pull requests anywhere this credential can see where `username`
   * plays `role`, newest activity first, at most one page of the host's search.
   * Requested reviewers are not filled in. A credential with no person behind it
   * (a GitHub App installation) answers an empty list without a request.
   */
  searchOpenPullRequests(search: PullRequestSearch): Promise<OpenPullRequest[]>
  /**
   * One pull request's approval and whether the host would merge it now. Not
   * part of the list read, because neither host puts approvals on its list.
   */
  pullRequestStatus(pr: PullRequestAddress): Promise<PullRequestStatus>
  /**
   * Merge it with the method the repository's own settings allow. Refused with
   * a `ConflictError` when the host will not merge it, or when its head is no
   * longer `expectedHeadSha`.
   */
  merge(pr: PullRequestAddress, expectedHeadSha: string): Promise<void>
  /**
   * The repositories under `owner` whose names contain `query`, as far as this
   * credential can see, at most one short page. Null when the credential cannot
   * search an owner at all: a GitHub App installation token is minted for one
   * repository, and there is none yet.
   */
  lookupRepositories(owner: string, query: string): Promise<RepositoryLookup | null>
  /**
   * The account this gateway's credential acts as, for a screen that has to say
   * who a deployment is reaching the host as, and for the workspace, which has
   * nothing else to decide whose pull requests to show. `null` when the
   * credential has no person behind it, which is what a GitHub App installation
   * token is: it acts as the App, not as anybody.
   */
  identify(): Promise<VcsAccount | null>
  /**
   * Who gave a verdict on the project's pull requests updated since `since`,
   * each pull request counted once per reviewer, over at most one page of the
   * most recently updated. A verdict is an approval or a request for changes;
   * GitLab records only approvals.
   */
  pastReviewers(project: ProjectRef, since: EpochMs): Promise<ReviewerTally[]>
}

/**
 * The user-facing half of a VCS connection: the browser round trip that turns a
 * sign-in into a credential this deployment holds.
 *
 * Separate from {@link VcsGateway} because the two are configured
 * independently. An OAuth client can be registered on a deployment that has no
 * credential yet (that is the point: it is how the credential arrives), and a
 * deployment given a token by hand needs no OAuth client at all.
 */
export interface VcsIdentityGateway {
  /** Where to send the browser to authorise. `state` comes back on the callback. */
  authorizeUrl(input: { redirectUri: string; state: string }): string
  /** Turn the callback's `code` into a durable credential, and say whose it is. */
  exchangeCode(input: {
    code: string
    redirectUri: string
  }): Promise<{ token: string; account: VcsAccount }>
}

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
  /**
   * Whether the host marks the account as a machine rather than a person: a
   * GitLab project or group access token's user, a GitLab service account, a
   * GitHub App's bot.
   */
  bot: boolean
}

/** How many of a project's pull requests one handle gave a verdict on. */
export interface ReviewerTally {
  login: string
  reviews: number
}

/** How many of a project's pull requests one handle opened. */
export interface AuthorTally {
  login: string
  pullRequests: number
}

/** Who was active in a project recently: who gave verdicts, and who opened pull requests. */
export interface ProjectActivity {
  reviewers: ReviewerTally[]
  authors: AuthorTally[]
}

/** Who has reviewed one open pull request. */
export interface OpenPullRequestReviews {
  /** The number the host shows on the page. */
  number: number
  /**
   * The handles that submitted a review, each once, as first spelled. The
   * author and bot accounts are left out. GitLab records nothing short of an
   * approval, so there it is the approvers.
   */
  reviewerLogins: string[]
  /**
   * The handles the host is still waiting on for a review: asked, and not
   * answered since. GitLab keeps a reviewer listed after they approve, so this
   * is narrower there than the pull request's requested reviewers.
   */
  awaitingLogins: string[]
}

/** One file a pull request changed, with its line counts. */
export interface ChangedFile {
  path: string
  /** The path before a rename, or null. */
  previousPath: string | null
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
}

/**
 * One review event on a pull request. GitLab has no review object, so there a
 * comment by somebody else is a review and approvals come from its system notes.
 */
export interface ReviewEvent {
  login: string
  /** The host marks the account as a machine (a GitHub App, a GitLab bot user). */
  bot: boolean
  kind: 'approved' | 'changes_requested' | 'commented'
  at: EpochMs
}

/** What a report needs of one pull request: when it was ready, reviewed, approved and merged. */
export interface PullRequestTimeline {
  number: number
  title: string
  url: string
  authorLogin: string | null
  /** The host marks the author as a machine (a GitHub App, a GitLab bot user). */
  authorBot: boolean
  /** Still a draft now. */
  draft: boolean
  createdAt: EpochMs
  /** When it was last marked ready for review, or `createdAt` when it never was a draft. */
  readyAt: EpochMs
  mergedAt: EpochMs | null
  /** When it was closed, merged or not. Null while open. */
  closedAt: EpochMs | null
  /** Every review event the read reached, in no promised order, the author's own included. */
  reviews: ReviewEvent[]
}

/** The pull requests opened in a project since a moment, and whether the read reached that far. */
export interface ReviewTimelines {
  pullRequests: PullRequestTimeline[]
  /** The read stopped at its page cap before reaching `since`. */
  truncated: boolean
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
   * Who was active in the project since `since`, over at most one page of its
   * most recently updated pull requests: who gave a verdict on them, each pull
   * request counted once per reviewer, and who opened the ones created in the
   * window. A verdict is an approval or a request for changes; GitLab records
   * only approvals.
   */
  pastActivity(project: ProjectRef, since: EpochMs): Promise<ProjectActivity>
  /**
   * Who has reviewed each of the project's open pull requests, over at most one
   * page of the most recently updated. A pull request with no entry was not
   * read, which is not the same as nobody having reviewed it.
   */
  openPullRequestReviews(project: ProjectRef): Promise<OpenPullRequestReviews[]>
  /**
   * The project's pull requests opened since `since`, open or not, each with
   * its review events, newest first, down to the same page cap the open reads
   * follow.
   */
  reviewTimelines(project: ProjectRef, since: EpochMs): Promise<ReviewTimelines>
  /**
   * The files the pull request changes, up to the host's own cap on one listing
   * (3000 on GitHub). `truncated` says the list stopped short of the whole diff.
   */
  changedFiles(pr: PullRequestAddress): Promise<{ files: ChangedFile[]; truncated: boolean }>
  /**
   * Approve the pull request as this gateway's account, at `headSha`. Refused
   * with a `ConflictError` when the head has moved; a host that will not take
   * the approval (from the author, from an account without access) fails the
   * call with its own refusal. Answers the host's id for the approval where it
   * has one, which is what withdrawing it later names.
   *
   * `body` travels with the approval only on a host whose approval carries text
   * (`bodyPosted`). Where it does not (GitLab), the caller posts it as a comment,
   * so a failed comment never reads as a refused approval.
   */
  approve(
    pr: PullRequestAddress,
    input: { headSha: string; body: string },
  ): Promise<{ approvalId: string | null; bodyPosted: boolean }>
  /**
   * Take back an approval this gateway's account gave. `message` travels with
   * the withdrawal where the host's dismissal carries text (`messagePosted`);
   * elsewhere the caller posts it as a comment.
   */
  withdrawApproval(
    pr: PullRequestAddress,
    input: { approvalId: string | null; message: string },
  ): Promise<{ messagePosted: boolean }>
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

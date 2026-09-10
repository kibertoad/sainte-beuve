import type {
  OpenPullRequest,
  ProjectRef,
  PullRequestRef,
  Reminder,
  ReviewRequest,
  VcsProvider,
} from '@sainte-beuve/contracts'

/**
 * Outbound ports: the three systems sainte-beuve talks to. Each is OPTIONAL on the
 * container: a deployment with no Slack token has no chat gateway, and the route
 * that needs one answers 503 naming what is not configured, rather than failing
 * deep inside a service with a null read.
 */

/** Chat delivery (Slack today). */
export interface ChatGateway {
  /** Announce a new review request to the team channel. Returns the message id, for threading. */
  announceReview(review: ReviewRequest, channelId: string): Promise<{ messageId: string }>
  /** Deliver one scheduled nudge. `target` is a Slack user id for a DM, a channel id otherwise. */
  sendReminder(reminder: Reminder, review: ReviewRequest, target: string): Promise<void>
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

/**
 * Source control. One interface for every host: GitHub calls the objects pull
 * requests and GitLab calls them merge requests, and the translation happens
 * inside the adapter so that nothing above this line carries a branch on which
 * host a project is on.
 */
export interface VcsGateway {
  /** Mirror the assignment onto the pull request, so the VCS stays the source of truth. */
  requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void>
  /**
   * Take the review request back off people who are no longer on the hook. The
   * other half of `requestReviewers`: a reroll that only added the replacement
   * would leave the previous reviewer with a pending request on the pull request
   * and the notifications that come with it.
   */
  removeRequestedReviewers(pr: PullRequestRef, logins: string[]): Promise<void>
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
   * The account this gateway's credential acts as, for a screen that has to say
   * who a deployment is reaching the host as, and for the workspace, which has
   * nothing else to decide whose pull requests to show. `null` when the
   * credential has no person behind it, which is what a GitHub App installation
   * token is: it acts as the App, not as anybody.
   */
  identify(): Promise<VcsAccount | null>
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

/** The handle a delegated AI review is tracked by. */
export interface AiReviewHandle {
  taskId: string
  /** Deep link into the cat-factory instance that accepted the task, when it gives one. */
  url: string | null
}

/**
 * What a poll found. `summary` is the verdict of a run that finished and
 * `failureReason` is why one did not: they are separate fields because the board
 * shows them in different places, and a gateway that writes the failure text into
 * the summary leaves a failed review looking like a reviewed one.
 */
export interface AiReviewReport {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  summary: string | null
  failureReason: string | null
}

/** cat-factory, reached over the published `@cat-factory/sdk`. */
export interface AiReviewGateway {
  /** Hand a pull request to cat-factory. Resolves once the task is accepted, not once it runs. */
  requestReview(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
  }): Promise<AiReviewHandle>
  /** Poll one delegated run. The Worker cron and the Node scheduler both drive this. */
  getStatus(taskId: string): Promise<AiReviewReport>
}

/**
 * Builds a gateway from a credential that was resolved at request time, for
 * whichever host the caller is reaching.
 *
 * The port exists because a credential can arrive AFTER boot: a token entered on
 * the Configuration screen has to take effect without a redeploy, and a gateway
 * built once at startup cannot be authenticated with something that did not exist
 * yet. So the runtime supplies a factory over the adapters it wired, and the
 * request layer asks it for a gateway once it knows which host and which
 * credential.
 *
 * `vcsAsApp` and `signIn` take a provider and return a gateway that was built
 * ONCE, at factory construction. Both hold a cache worth keeping across requests:
 * the App path memoises an imported RSA key and the installation tokens it mints,
 * and building a fresh instance per call would throw both away on a runtime
 * billed by CPU time.
 */
export interface GatewayFactory {
  /** Chat, authenticated with a Slack bot token. */
  chat(botToken: string): ChatGateway
  /**
   * Source control, authenticated with a token belonging to somebody: a PAT, or
   * a sign-in. Null for a host this build has no adapter for.
   */
  vcsFromToken(provider: VcsProvider, token: string): VcsGateway | null
  /**
   * Source control, authenticated as the deployment's own app. Null when none is
   * configured, which is always the case for a host with no App concept.
   */
  vcsAsApp(provider: VcsProvider): VcsGateway | null
  /**
   * The AI reviewer, from an API key. Null when the REST of its configuration is
   * missing: a key with no base URL and no service id names an instance nothing
   * can reach, and reporting that as configured is how a stored credential comes
   * to sit beside a route that answers 503.
   */
  aiReview(apiKey: string): AiReviewGateway | null
  /** The sign-in round trip for one host. Null when no OAuth client is configured for it. */
  signIn(provider: VcsProvider): VcsIdentityGateway | null
}

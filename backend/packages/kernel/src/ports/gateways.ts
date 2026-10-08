import type {
  AiReviewCuration,
  AiReviewResolution,
  AskGuidedReviewInput,
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewExchange,
  GuidedReviewPostResult,
  GuidedReviewSessionView,
  GuidedReviewStreamEvent,
  GuidedReviewTarget,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  OpenPullRequest,
  PostGuidedReviewDraftsInput,
  ProjectRef,
  PullRequestRef,
  PullRequestStatus,
  Reminder,
  RequestGuidedReviewDraftsInput,
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

/** A pull request by the coordinates every host addresses it by. */
export type PullRequestAddress = ProjectRef & { number: number }

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
 *
 * `runId` is here because a review is a LOOP: the task id is what we filed, and
 * cat-factory addresses every curation verb by the run executing it. A task is
 * accepted before its run exists, so the two ids do not arrive together and the
 * second one is learnt by polling.
 */
export interface AiReviewReport {
  status: 'running' | 'awaiting_selection' | 'completed' | 'failed' | 'cancelled'
  runId: string | null
  summary: string | null
  failureReason: string | null
  /** What there is to curate right now, or null for a run carrying no review. */
  curation: AiReviewCuration | null
}

/**
 * cat-factory, reached over the published `@cat-factory/sdk`.
 *
 * Filing is addressed by TASK because that is what we hold after
 * `requestReview`; everything after it is addressed by RUN, which is what
 * cat-factory's decision surface is keyed on. The asymmetry is deliberate: a
 * gateway that took a task id for the curation verbs would have to re-resolve
 * the run on every call, and would silently act on a different run than the one
 * whose findings the caller is looking at.
 */
export interface AiReviewGateway {
  /** Hand a pull request to cat-factory. Resolves once the task is accepted, not once it runs. */
  requestReview(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
  }): Promise<AiReviewHandle>
  /** Poll one delegated run. The Worker cron and the Node scheduler both drive this. */
  getStatus(taskId: string): Promise<AiReviewReport>
  /**
   * Drop one finding from the parked review. The review stays parked.
   *
   * SYNCHRONOUS, and it answers with the curation the drop left behind, which is
   * the whole effect: a caller that re-polled after this would spend two more
   * upstream calls to be told what this answer already says. Null for a run that
   * came back carrying no review to curate.
   */
  dismissFinding(input: { runId: string; findingId: string }): Promise<AiReviewCuration | null>
  /**
   * Record the curated selection and act on it. ASYNCHRONOUS: it resolves once
   * cat-factory has ACCEPTED the instruction, and what actually landed arrives on
   * a later poll as `postReport`.
   */
  resolveReview(input: {
    runId: string
    action: AiReviewResolution
    findingIds: string[]
  }): Promise<void>
  /**
   * Re-dispatch the slices a stalled review never got back. Which ones is derived
   * from what the run observed, so there is nothing to pass.
   */
  resumeReview(input: { runId: string }): Promise<void>
}

/**
 * What a guided review's upstream stream yields: the frames a screen receives,
 * and `timeout` when cat-factory capped the connection and expects a reconnect.
 */
export type GuidedReviewWatchEvent = GuidedReviewStreamEvent | { kind: 'timeout' }

/**
 * cat-factory's guided review of one pull request, over the published SDK.
 *
 * Every session belongs to the API key this deployment holds, so a pull request
 * has ONE guided review per deployment, shared by everybody who opens it. That
 * is the board's model too: a review row is the team's, not one person's.
 *
 * Every write resolves with what cat-factory persisted, before the overview or
 * the answer exists. The caller re-reads until nothing is pending. Posting
 * drafts is the one call that reaches the pull request, and it posts on the
 * cat-factory workspace's credentials, because the key belongs to no person.
 */
export interface GuidedReviewGateway {
  /** The session this deployment holds for a pull request, or null. Spends nothing. */
  find(target: GuidedReviewTarget): Promise<GuidedReviewSessionView | null>
  /** Open a session, or answer with the one already open. Spends model budget when new. */
  open(target: GuidedReviewTarget): Promise<GuidedReviewSessionView>
  get(sessionId: string): Promise<GuidedReviewSessionView>
  /** Regenerate the overview at the pull request's current head. */
  refresh(sessionId: string): Promise<GuidedReviewSessionView>
  openThread(sessionId: string, input: OpenGuidedReviewThreadInput): Promise<GuidedReviewThreadView>
  getThread(sessionId: string, threadId: string): Promise<GuidedReviewThreadView>
  ask(
    sessionId: string,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange>
  requestDrafts(
    sessionId: string,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange>
  editDraft(
    sessionId: string,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft>
  postDrafts(sessionId: string, input: PostGuidedReviewDraftsInput): Promise<GuidedReviewPostResult>
  /**
   * The session's changes as cat-factory pushes them, until it caps the
   * connection or `signal` aborts. Rejects on the first iteration if the stream
   * cannot be opened.
   */
  watch(sessionId: string, signal: AbortSignal): AsyncIterable<GuidedReviewWatchEvent>
}

/** Where an org's cat-factory is, and the key it reaches it with. */
export interface CatFactoryAccess {
  baseUrl: string
  apiKey: string
}

/** What filing an AI review needs on top of access: the service, and optionally a pipeline. */
export interface CatFactoryReviewTarget extends CatFactoryAccess {
  /** Null for a gateway that only polls and curates runs already filed. Filing refuses without one. */
  serviceId: string | null
  /** Null runs the review task's own pinned pipeline. */
  pipelineId: string | null
}

/**
 * What an instance said about a key. `outcome` is the first thing that went
 * wrong, so a screen can say which of the URL and the key to fix; the lists are
 * empty unless the key was accepted.
 */
export interface CatFactoryProbeReport {
  outcome: 'ok' | 'unreachable' | 'unauthorized' | 'refused'
  /** What the instance or the transport said, when it was not `ok`. */
  detail: string | null
  /** The key's rung on cat-factory's inclusive ladder: `read` < `write` < `decide` < `admin`. */
  scope: string | null
  services: { id: string; title: string }[]
  pipelines: { id: string; name: string }[]
}

export interface CatFactoryProbe {
  probe(): Promise<CatFactoryProbeReport>
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
  /** The AI reviewer, for one org's cat-factory key, instance and service. */
  aiReview(target: CatFactoryReviewTarget): AiReviewGateway
  /**
   * The guided reviewer, from the same key and instance. It needs no service id,
   * because cat-factory finds the repository from the pull request's own
   * coordinates.
   */
  guidedReview(access: CatFactoryAccess): GuidedReviewGateway
  /** Asks an instance what a key may do there, for the Configuration screen's check. */
  catFactoryProbe(access: CatFactoryAccess): CatFactoryProbe
  /** The sign-in round trip for one host. Null when no OAuth client is configured for it. */
  signIn(provider: VcsProvider): VcsIdentityGateway | null
}

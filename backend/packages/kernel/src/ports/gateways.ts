import type {
  AiReviewCuration,
  AiReviewResolution,
  AttentionRequest,
  PullRequestRef,
  Reminder,
  ReviewRequest,
  VcsProvider,
} from '@sainte-beuve/contracts'
import type { GuidedReviewGateway } from './guided-review.js'
import type { RepositoryDirectoryGateway } from './repository-directory.js'
import type { VcsGateway, VcsIdentityGateway } from './vcs.js'

/**
 * Outbound ports: the three systems sainte-beuve talks to. Each is OPTIONAL on the
 * container: a deployment with no Slack token has no chat gateway, and the route
 * that needs one answers 503 naming what is not configured, rather than failing
 * deep inside a service with a null read.
 */

/** Where a chat message landed: the conversation (a DM's own id, not the user's) and the message in it. */
export interface ChatMessageRef {
  conversationId: string
  messageId: string
}

/**
 * An attention ask as one recipient sees it. The matched skills and domains say
 * why they were asked; they are empty when the message is re-rendered after the
 * ask has moved on, because a closed ask has nothing left to persuade anybody of.
 */
export interface AttentionAskNotice {
  request: AttentionRequest
  recipientId: string
  matchedSkills: readonly string[]
  matchedDomains: readonly string[]
}

/** Chat delivery (Slack today). */
export interface ChatGateway {
  /** Announce a new review request to the team channel. Returns the message id, for threading. */
  announceReview(review: ReviewRequest, channelId: string): Promise<{ messageId: string }>
  /** Deliver one scheduled nudge. `target` is a Slack user id for a DM, a channel id otherwise. */
  sendReminder(reminder: Reminder, review: ReviewRequest, target: string): Promise<void>
  /** DM one person an ask addressed to them. `target` is their Slack user id. */
  sendAttentionAsk(notice: AttentionAskNotice, target: string): Promise<ChatMessageRef>
  /** Re-render a delivered ask in the state its request is in now. */
  updateAttentionAsk(notice: AttentionAskNotice, message: ChatMessageRef): Promise<void>
  /**
   * DM the requester that declines left their named ask short of people to
   * answer it, and nobody was asked on. `target` is their Slack user id.
   */
  sendAttentionShort(request: AttentionRequest, target: string): Promise<void>
}

/** The handle a delegated AI review is tracked by. */
export interface AiReviewHandle {
  taskId: string
  /** Deep link into the cat-factory instance that accepted the task, when it gives one. */
  url: string | null
  /**
   * The cat-factory workspace the task was filed in, or null when it went to the
   * key's only workspace. Every later call about the run names it again: a key
   * reaching several workspaces is refused a call that names none.
   */
  workspaceId: string | null
}

/** The workspace a run was filed in, which every call about it names. */
export interface AiReviewWorkspace {
  /** See {@link AiReviewHandle.workspaceId}. */
  workspaceId: string | null
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
  /**
   * Hand a pull request to cat-factory. Resolves once the task is accepted, not
   * once it runs.
   *
   * The task goes under the service that backs the pull request's repository,
   * found through `directoryKeys`: the keys the org's repository mirror holds
   * that repository under, one per workspace linking it. When no service backs
   * it, the task goes to the default service, and with no default it is refused
   * naming both fixes.
   */
  requestReview(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
    directoryKeys: readonly string[]
  }): Promise<AiReviewHandle>
  /** Poll one delegated run. The Worker cron and the Node scheduler both drive this. */
  getStatus(input: { taskId: string } & AiReviewWorkspace): Promise<AiReviewReport>
  /**
   * Drop one finding from the parked review. The review stays parked.
   *
   * SYNCHRONOUS, and it answers with the curation the drop left behind, which is
   * the whole effect: a caller that re-polled after this would spend two more
   * upstream calls to be told what this answer already says. Null for a run that
   * came back carrying no review to curate.
   */
  dismissFinding(
    input: { runId: string; findingId: string } & AiReviewWorkspace,
  ): Promise<AiReviewCuration | null>
  /**
   * Record the curated selection and act on it. ASYNCHRONOUS: it resolves once
   * cat-factory has ACCEPTED the instruction, and what actually landed arrives on
   * a later poll as `postReport`.
   */
  resolveReview(
    input: { runId: string; action: AiReviewResolution; findingIds: string[] } & AiReviewWorkspace,
  ): Promise<void>
  /**
   * Re-dispatch the slices a stalled review never got back. Which ones is derived
   * from what the run observed, so there is nothing to pass.
   */
  resumeReview(input: { runId: string } & AiReviewWorkspace): Promise<void>
}

/** Where an org's cat-factory is, and the key it reaches it with. */
export interface CatFactoryAccess {
  baseUrl: string
  apiKey: string
}

/** What filing an AI review needs on top of access: a default service, and optionally a pipeline. */
export interface CatFactoryReviewTarget extends CatFactoryAccess {
  /**
   * The service a review goes under when no service backs its repository in
   * cat-factory. Null files a review only under its repository's own service.
   */
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
  /** The AI reviewer, for one org's cat-factory key, instance and default service. */
  aiReview(target: CatFactoryReviewTarget): AiReviewGateway
  /**
   * The guided reviewer, from the same key and instance. It needs no service id,
   * because cat-factory finds the repository from the pull request's own
   * coordinates.
   */
  guidedReview(access: CatFactoryAccess): GuidedReviewGateway
  /** Asks an instance what a key may do there, for the Configuration screen's check. */
  catFactoryProbe(access: CatFactoryAccess): CatFactoryProbe
  /** The account directory the org's repository list is mirrored from. */
  catFactoryDirectory(access: CatFactoryAccess): RepositoryDirectoryGateway
  /** The sign-in round trip for one host. Null when no OAuth client is configured for it. */
  signIn(provider: VcsProvider): VcsIdentityGateway | null
}

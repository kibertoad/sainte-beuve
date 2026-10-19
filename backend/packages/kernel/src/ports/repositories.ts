import type {
  AiReviewRun,
  IdentityProvider,
  LinkedIdentity,
  Project,
  ProjectRef,
  Reminder,
  ReminderStatus,
  Reviewer,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '../domain/types.js'
import type { ApiKeyRepository, SessionRepository } from './auth.js'
import type { HostSnapshotRepository } from './host-snapshots.js'
import type { PullRequestAssessmentRepository } from './pull-request-assessments.js'
import type { IntegrationConfigRepository } from './integration-config.js'
import type { ExternalDirectoryRepository } from './external-directory.js'
import type { ExternalRepositoryRepository } from './external-repositories.js'
import type { RiskAssessmentRepository } from './risk.js'
import type { TeamRepository } from './teams.js'
import type { PullRequestAddress } from './vcs.js'
import type { AttentionRepository, ReviewCommitmentRepository } from './attention.js'

/**
 * Persistence ports. There are three implementations (in-memory in
 * @sainte-beuve/persistence-memory, D1 in @sainte-beuve/persistence-d1,
 * Postgres in @sainte-beuve/persistence-postgres), one shared suite that proves
 * they behave alike (@sainte-beuve/persistence-conformance), and nothing above
 * this line knows which one it got.
 *
 * The methods are deliberately coarse: `listDue` rather than a query builder, so a
 * store can answer it with one index and no caller can accidentally write an N+1.
 *
 * NONE OF THEM TAKES AN ORG. Every repository below is already bound to one
 * before a service can reach it (`PersistenceProvider.forOrg`), so the tenancy
 * is a property of the object rather than an argument every call site has to
 * remember. That is the difference between a boundary and a convention: a
 * `listDue(orgId, now, limit)` is one forgotten parameter away from answering
 * with somebody else's reminders, and there is no parameter here to forget.
 */

export interface ReviewerRepository {
  list(): Promise<Reviewer[]>
  getById(reviewerId: string): Promise<Reviewer | null>
  create(reviewer: Reviewer): Promise<Reviewer>
  update(reviewerId: string, patch: Partial<Reviewer>): Promise<Reviewer | null>
  /** Move the outstanding-review counter selection reads. Negative deltas resolve a review. */
  adjustOutstanding(reviewerId: string, delta: number): Promise<void>
}

/**
 * Which end of the table a capped read keeps, ties broken on the id the same way.
 *
 * It exists because the cap and the order are the same decision: a `limit` takes
 * the rows the ORDER put first, so a read ordered the wrong way drops exactly
 * the rows the caller was asking for. History wants `newest` — the review that
 * just settled is the interesting one. A QUEUE wants `oldest`, because the board
 * promises the ones waiting longest and those are the first a newest-first cap
 * throws away.
 */
export type ReviewListOrder = 'newest' | 'oldest'

export interface ReviewRequestRepository {
  /**
   * The board, newest first unless asked otherwise, ties broken on the id.
   *
   * `limit` is not a nicety: terminal reviews are never archived, so an
   * unbounded read grows with everything the deployment has ever tracked and
   * the JSON it decodes grows with it. Every caller that wants the BOARD passes
   * one; the ones that want a set they have already narrowed (a status filter
   * over the active three) may leave it off.
   *
   * `order` is what makes that cap answer the right question — see
   * `ReviewListOrder`. It moves the id tie-break with it, so a read stays TOTAL
   * either way and two rows sharing a millisecond cannot swap between reads.
   */
  list(filter?: {
    status?: ReviewStatus[]
    limit?: number
    order?: ReviewListOrder
  }): Promise<ReviewRequest[]>
  getById(reviewId: string): Promise<ReviewRequest | null>
  /**
   * Look up by pull request so a webhook replay updates the row instead of
   * duplicating it. Matched on `pullRequestKey`: the host is part of it, and
   * the path is compared without case.
   */
  getByPullRequest(ref: PullRequestAddress): Promise<ReviewRequest | null>
  /**
   * `getByPullRequest` for a list screen's worth at once, in no promised order.
   * A pull request nothing tracks has no row in the answer.
   */
  listByPullRequests(refs: readonly PullRequestAddress[]): Promise<ReviewRequest[]>
  /**
   * One repository's reviews in the named statuses, created at or after `since`,
   * newest first with the id as the tie-break, capped at `limit`. What a
   * reviewer's familiarity with a repository is counted from.
   *
   * Matched on `projectRefKey`: the same owner and repo on the other host is
   * another repository, and its history would credit people with reviews of
   * code they never read.
   */
  listForRepository(
    repository: ProjectRef,
    filter: { status: readonly ReviewStatus[]; since: EpochMs; limit: number },
  ): Promise<ReviewRequest[]>
  create(review: ReviewRequest): Promise<ReviewRequest>
  update(reviewId: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest | null>
}

export interface ReminderRepository {
  listByReview(reviewId: string): Promise<Reminder[]>
  /** Reminders whose `dueAt` has passed and which are still `scheduled`. The tick's only read. */
  listDue(now: EpochMs, limit: number): Promise<Reminder[]>
  /**
   * TAKE a due reminder, so that exactly one sender posts it. True if this
   * caller got it, false if it was already taken or is no longer scheduled.
   *
   * One conditional statement on both durable stores — the move out of
   * `scheduled` and the write of the payload together — because that is the
   * only shape that answers the question honestly. `listDue` is a read, and two
   * passes over the same batch are not a hypothetical: a deployment running two
   * Node replicas has two clocks, and the Worker's cron can fire while the last
   * invocation is still inside `waitUntil`. Without a claim both post, and a
   * duplicated nudge is exactly the thing reminders must not do.
   *
   * It takes the reminder rather than its id because the status lives in the
   * payload as well as in the column, and the two must not disagree; the caller
   * is holding the row it just read.
   *
   * `claimedAt` is stamped on the row the claim writes, and is the LEASE the
   * recovery read below runs on: without it a row whose sender died is
   * indistinguishable from one still mid-post, and the ladder it belongs to
   * ends there. The caller passes its own clock rather than the store reading
   * one, for the reason every other decision in this tree injects it.
   */
  claim(reminder: Reminder, claimedAt: EpochMs): Promise<boolean>
  /**
   * Reminders stuck in `sending` since before `claimedBefore`: a sender that
   * took the row and never came back.
   *
   * The counterpart to `claim`, and the reason the claim carries a timestamp.
   * `listDue` reads `scheduled` only, so a stranded row is invisible to every
   * later pass, and because the policy re-plans a review's ladder only after a
   * delivery settles, that review is never nudged again. Recovery is what the
   * tick does with these — see `recoverStalledClaims`.
   *
   * Capped and oldest-claim-first like `listDue`, so a deployment that
   * crash-looped through a batch recovers a slice per tick rather than in one
   * unbounded pass.
   */
  listStalledClaims(claimedBefore: EpochMs, limit: number): Promise<Reminder[]>
  /**
   * GIVE UP on a claim nobody finished: `failed`, with the reason, if the row is
   * still `sending`. True if this caller is the one that gave up on it.
   *
   * Conditional for `claim`'s reason, and against the same two passes. Recovery
   * re-plans the review's ladder, which is a cancel and a create, and two
   * recoveries of one row would run that twice — leaving the review with two
   * scheduled nudges, which is the duplicate the claim exists to prevent,
   * reintroduced by the thing that repairs it. Only the caller this answers true
   * re-plans.
   */
  abandonClaim(reminder: Reminder, failureReason: string): Promise<boolean>
  create(reminder: Reminder): Promise<Reminder>
  updateStatus(
    reminderId: string,
    status: ReminderStatus,
    fields?: { sentAt?: EpochMs; failureReason?: string },
  ): Promise<void>
  /** Drop the outstanding schedule for a review that reached a verdict. */
  cancelScheduledForReview(reviewId: string): Promise<void>
}

/**
 * One integration's credential, as it sits in the store: SEALED, plus the two
 * things a configuration screen can show without opening it. The plaintext never
 * reaches a repository, so a store dump carries no usable credential.
 */
export interface StoredIntegrationToken {
  integrationId: string
  /** The envelope produced by the deployment's `SecretCipher`. */
  sealed: string
  /** The last four characters of the token, so an operator can tell which one is stored. */
  hint: string
  /**
   * Whose credential this is, when the flow that stored it knows: the GitHub
   * login behind a sign-in, say. Null for a credential somebody pasted, because
   * a pasted token names nobody. It is here rather than derived from the token
   * because deriving it means holding the credential, and a status read must
   * not.
   */
  subject: string | null
  /**
   * Whether the host marks the subject as a machine account (see
   * `VcsAccount.bot`). False when the credential names nobody.
   */
  subjectIsBot: boolean
  updatedAt: EpochMs
}

/** One row per integration that has a token. Keyed by integration id, not by a surrogate. */
export interface IntegrationTokenRepository {
  list(): Promise<StoredIntegrationToken[]>
  get(integrationId: string): Promise<StoredIntegrationToken | null>
  /** Store or replace the token for one integration. */
  put(token: StoredIntegrationToken): Promise<StoredIntegrationToken>
  delete(integrationId: string): Promise<void>
}

export interface AiReviewRunRepository {
  listByReview(reviewId: string): Promise<AiReviewRun[]>
  /** Every run of the named reviews, in no promised order. */
  listByReviews(reviewIds: readonly string[]): Promise<AiReviewRun[]>
  /**
   * The runs still in flight, LEAST RECENTLY POLLED first. The clock's only read.
   *
   * cat-factory calls nothing back, so a review that parks with findings is a
   * fact nobody holds until somebody asks for it. This is what lets the reminder
   * tick ask on everybody's behalf instead of leaving a parked review invisible
   * until its author happens to open the row.
   *
   * `AI_REVIEW_IN_FLIGHT_STATUSES` is what "in flight" means, and all three
   * stores read it from the contract rather than spelling it out.
   *
   * The ORDER is what keeps the batch cap a rate limit instead of a queue with a
   * permanent head. A run that has never been polled sorts first (`lastPolledAt`
   * is null), and after that the one polled longest ago; `requestedAt` and the id
   * break the ties, so the read is total and two stores cannot disagree about it.
   * Ordered by `requestedAt` alone, a tenancy holding a batch's worth of reviews
   * parked on their findings — a state only a person leaves, never a poll — would
   * fill every batch for ever and no newer review would be polled at all.
   */
  listInFlight(limit: number): Promise<AiReviewRun[]>
  getById(runId: string): Promise<AiReviewRun | null>
  create(run: AiReviewRun): Promise<AiReviewRun>
  update(runId: string, patch: Partial<AiReviewRun>): Promise<AiReviewRun | null>
}

/** The projects a workspace sweeps. Keyed by id; unique on `(provider, owner, repo)`. */
export interface ProjectRepository {
  list(): Promise<Project[]>
  getById(projectId: string): Promise<Project | null>
  /** The registered project for a repository, so registering it twice updates one row. */
  getByRef(ref: { provider: string; owner: string; repo: string }): Promise<Project | null>
  create(project: Project): Promise<Project>
  update(projectId: string, patch: Partial<Project>): Promise<Project | null>
  delete(projectId: string): Promise<void>
}

/**
 * The accounts a person is known by on the source-control hosts, keyed on
 * `(provider, subject)`.
 *
 * A side table rather than columns on the reviewer, for the reason the identity
 * contract gives: one person holds several, and the handle a host shows is not
 * the thing to key on. The `reviewerId` is the canonical person.
 */
export interface IdentityRepository {
  /** The person behind one external account, or null. */
  findReviewerId(provider: IdentityProvider, subject: string): Promise<string | null>
  listForReviewer(reviewerId: string): Promise<LinkedIdentity[]>
  /**
   * Attach an account to a person, and answer whose it is NOW.
   *
   * The key `(provider, subject)` is claimed by the first caller and the answer
   * is the reviewer holding it, which is not always the one that was passed in.
   * That return value is the store's uniqueness rule made usable: two first
   * requests that both found no row and both created one are how a directory
   * forks into two people with one account between them, and the loser needs to
   * be told which row won rather than keeping its own.
   *
   * A caller that already owns the key refreshes the handle with it, so the
   * write is an upsert for its own row and a no-op for anybody else's.
   */
  link(reviewerId: string, identity: LinkedIdentity): Promise<string>
}

/**
 * Which store a facade actually wired.
 *
 * Reported on `/health`, because "is this deployment durable?" is a question an
 * operator has to be able to answer from outside the process, and the in-memory
 * store is a legitimate answer for local mode and a loud one anywhere else.
 */
export type PersistenceKind = 'memory' | 'd1' | 'postgres'

/** The stores a runtime has to supply, handed to the services as one object. */
export interface Repositories {
  reviewers: ReviewerRepository
  reviews: ReviewRequestRepository
  reminders: ReminderRepository
  aiReviewRuns: AiReviewRunRepository
  integrationTokens: IntegrationTokenRepository
  integrationConfigs: IntegrationConfigRepository
  projects: ProjectRepository
  identities: IdentityRepository
  attention: AttentionRepository
  commitments: ReviewCommitmentRepository
  sessions: SessionRepository
  apiKeys: ApiKeyRepository
  teams: TeamRepository
  externalRepositories: ExternalRepositoryRepository
  externalDirectory: ExternalDirectoryRepository
  riskAssessments: RiskAssessmentRepository
  hostSnapshots: HostSnapshotRepository
  pullRequestAssessments: PullRequestAssessmentRepository
}

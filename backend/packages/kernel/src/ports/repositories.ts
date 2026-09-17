import type {
  AiReviewRun,
  AttentionRequest,
  AttentionStatus,
  IdentityProvider,
  LinkedIdentity,
  Project,
  Reminder,
  ReminderStatus,
  Reviewer,
  ReviewCommitment,
  ReviewRequest,
  ReviewStatus,
  Role,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '../domain/types.js'

/**
 * A stored payload that does not match the contract it is supposed to be.
 *
 * Raised by the durable stores when a `data` column fails its schema on read.
 * That is a deployment fault rather than a caller's: the row was written by an
 * older contract, or by hand, and nothing the request did can fix it. It is
 * deliberately NOT a `DomainError`, so the shared handler answers 500 and logs it
 * instead of turning it into a refusal that reads as the operator's mistake.
 *
 * The message names the table and the row, because the fix is a statement against
 * that row and an operator should not have to go looking for which one.
 */
export class StoredRowError extends Error {
  readonly table: string
  readonly rowId: string
  readonly issues: readonly string[]

  constructor(table: string, rowId: string, issues: readonly string[]) {
    super(`Stored ${table} row ${rowId} does not match its contract: ${issues.join('; ')}`)
    this.name = new.target.name
    this.table = table
    this.rowId = rowId
    this.issues = issues
  }
}

export function isStoredRowError(err: unknown): err is StoredRowError {
  return err instanceof StoredRowError
}

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

export interface ReviewRequestRepository {
  list(filter?: { status?: ReviewStatus[] }): Promise<ReviewRequest[]>
  getById(reviewId: string): Promise<ReviewRequest | null>
  /** Look up by pull request so a webhook replay updates the row instead of duplicating it. */
  getByPullRequest(ref: {
    owner: string
    repo: string
    number: number
  }): Promise<ReviewRequest | null>
  create(review: ReviewRequest): Promise<ReviewRequest>
  update(reviewId: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest | null>
}

export interface ReminderRepository {
  listByReview(reviewId: string): Promise<Reminder[]>
  /** Reminders whose `dueAt` has passed and which are still `scheduled`. The tick's only read. */
  listDue(now: EpochMs, limit: number): Promise<Reminder[]>
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
  /**
   * The runs still in flight, oldest request first. The clock's only read.
   *
   * cat-factory calls nothing back, so a review that parks with findings is a
   * fact nobody holds until somebody asks for it. This is what lets the reminder
   * tick ask on everybody's behalf instead of leaving a parked review invisible
   * until its author happens to open the row.
   *
   * `AI_REVIEW_IN_FLIGHT_STATUSES` is what "in flight" means, and all three
   * stores read it from the contract rather than spelling it out. Oldest first
   * because the batch cap is a cap: the run that has been waiting longest is the
   * one a person is most likely to be waiting on.
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

export interface AttentionRepository {
  list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]>
  getById(attentionId: string): Promise<AttentionRequest | null>
  create(request: AttentionRequest): Promise<AttentionRequest>
  update(attentionId: string, patch: Partial<AttentionRequest>): Promise<AttentionRequest | null>
}

export interface ReviewCommitmentRepository {
  listByReviewer(reviewerId: string): Promise<ReviewCommitment[]>
  getById(commitmentId: string): Promise<ReviewCommitment | null>
  /**
   * What one person already promised about one pull request, so a second click
   * is a no-op.
   *
   * The `provider` is part of the key, not decoration: `platform/api#12` on
   * GitHub and `platform/api#12` on GitLab are two different changes, and a
   * lookup that matched on the path alone would answer the second with the
   * first, leave no commitment row for it, and put the wrong host's pull
   * request on somebody's workspace.
   */
  find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null>
  create(commitment: ReviewCommitment): Promise<ReviewCommitment>
  delete(commitmentId: string): Promise<void>
}

/**
 * A session, as it sits in the store: the same fields the contract carries, plus
 * the one that must never be on the wire.
 *
 * A kernel type rather than the contract object in a payload column, for the
 * reason the integration tokens are one: the row is flat, every field is queried
 * or shown, and the digest has to stay OUT of what a route can answer with. A
 * payload that held it would be one careless `c.json(session)` away from handing
 * a caller the means to present somebody else's session.
 */
export interface StoredSession {
  id: string
  /**
   * The digest of the token that presents this session, NOT the token. A session
   * value is 256 bits of randomness, so an unkeyed digest is enough to make the
   * stored row useless to whoever reads the database: there is nothing to guess
   * and no dictionary to run. Keying it would tie every live session to the
   * deployment's encryption key and sign everybody out on a rotation, for no
   * gain over a value that cannot be searched for in the first place.
   */
  tokenDigest: string
  /**
   * The tenancy this session is in, decided when it was established and never
   * afterwards. It is what `PersistenceProvider.forOrg` is handed on every
   * request the cookie arrives on, so a session cannot be carried across the
   * boundary by anything the caller sends.
   */
  orgId: string
  /** The person, as `@sainte-beuve/contracts` means it: a reviewer row. */
  reviewerId: string
  /** The host account they proved, keyed the way an identity always is. */
  provider: IdentityProvider
  subject: string
  createdAt: EpochMs
  lastSeenAt: EpochMs
  expiresAt: EpochMs
}

/**
 * The sessions a browser is carried by, within one org.
 *
 * The read on every authenticated request is NOT here: resolving a digest is
 * what decides which org the request is in, so it cannot be asked of a store
 * already bound to one. It lives on `TenancyDirectory` instead, and what is left
 * here is everything a request does once it knows where it is.
 */
export interface SessionRepository {
  create(session: StoredSession): Promise<StoredSession>
  /** Move `lastSeenAt` without rewriting the row. A no-op for a session that is gone. */
  touch(sessionId: string, lastSeenAt: EpochMs): Promise<void>
  delete(sessionId: string): Promise<void>
  /**
   * Drop every session of one person. What a directory change needs: pausing
   * somebody, or a reviewer row being merged into another, must not leave a
   * cookie that still resolves to the old one.
   */
  deleteForReviewer(reviewerId: string): Promise<void>
  /**
   * Drop everything already expired, and say how many went. Called by the
   * reminder tick, because a store nothing sweeps grows one row per sign-in for
   * ever and the expired ones are refused on read anyway.
   */
  deleteExpired(now: EpochMs): Promise<number>
}

/**
 * A key a machine calls with, as it sits in the store. Beside the digest that
 * matches it, for the same reason a session's is: the value itself exists once.
 */
export interface StoredApiKey {
  id: string
  tokenDigest: string
  /** The tenancy the key was minted in. Fixed at mint time, like a session's. */
  orgId: string
  label: string
  /** What the key may do in that org. See `roleSchema`. */
  role: Role
  /** The last four characters, so a row can be matched to an entry in a secret store. */
  hint: string
  /** The reviewer who minted it, when a person did. Null for one nobody is behind. */
  createdBy: string | null
  createdAt: EpochMs
  lastUsedAt: EpochMs | null
}

export interface ApiKeyRepository {
  /** Newest first, which is the order a directory of credentials is read in. */
  list(): Promise<StoredApiKey[]>
  create(key: StoredApiKey): Promise<StoredApiKey>
  touch(keyId: string, lastUsedAt: EpochMs): Promise<void>
  delete(keyId: string): Promise<void>
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
  projects: ProjectRepository
  identities: IdentityRepository
  attention: AttentionRepository
  commitments: ReviewCommitmentRepository
  sessions: SessionRepository
  apiKeys: ApiKeyRepository
}

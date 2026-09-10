import type {
  AiReviewRun,
  Reminder,
  ReminderStatus,
  Reviewer,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '../domain/types.js'

/**
 * Persistence ports. Every runtime supplies its own implementation (in-memory
 * today (@sainte-beuve/persistence-memory), D1 on the Worker and Postgres on the
 * Node service once the storage slice lands), and nothing above this line knows
 * which one it got.
 *
 * The methods are deliberately coarse: `listDue` rather than a query builder, so a
 * store can answer it with one index and no caller can accidentally write an N+1.
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
  getById(runId: string): Promise<AiReviewRun | null>
  create(run: AiReviewRun): Promise<AiReviewRun>
  update(runId: string, patch: Partial<AiReviewRun>): Promise<AiReviewRun | null>
}

/** The stores a runtime has to supply, handed to the services as one object. */
export interface Repositories {
  reviewers: ReviewerRepository
  reviews: ReviewRequestRepository
  reminders: ReminderRepository
  aiReviewRuns: AiReviewRunRepository
  integrationTokens: IntegrationTokenRepository
}

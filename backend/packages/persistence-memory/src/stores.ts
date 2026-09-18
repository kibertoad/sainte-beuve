import { AI_REVIEW_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type {
  AiReviewRun,
  Reminder,
  ReminderStatus,
  Reviewer,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import type {
  AiReviewRunRepository,
  EpochMs,
  IntegrationTokenRepository,
  ReminderRepository,
  Repositories,
  ReviewerRepository,
  ReviewListOrder,
  ReviewRequestRepository,
  StoredIntegrationToken,
} from '@sainte-beuve/kernel'
import { InMemoryApiKeyRepository, InMemorySessionRepository } from './auth-stores.js'
import { clone, patched } from './clone.js'
import { byText, leastRecentlyPolledFirst, newestFirst, oldestFirst } from './order.js'
import {
  InMemoryAttentionRepository,
  InMemoryIdentityRepository,
  InMemoryProjectRepository,
  InMemoryReviewCommitmentRepository,
} from './workspace-stores.js'

/**
 * In-memory implementations of the repository ports.
 *
 * This was deliberately the FIRST adapter rather than a test double retrofitted
 * later, and the durable ones are the argument for it: writing the ports
 * against a store that cannot cheat (no SQL escape hatch, no lazy loading) is
 * what kept them coarse enough for D1 (@sainte-beuve/persistence-d1) and
 * Postgres (@sainte-beuve/persistence-postgres) to implement without an N+1.
 *
 * It is still what a facade boots with when no database is configured: local
 * mode, a `wrangler dev` before anybody has created a D1, a first container
 * run. `/health` reports it as `persistence: "memory"`, because a store a
 * restart empties is the right answer on a laptop and an alarm anywhere else.
 *
 * Every read returns a COPY (see `clone.ts` for why), which is one of the
 * behaviours `@sainte-beuve/persistence-conformance` holds all three stores to.
 * The workspace stores live in `workspace-stores.ts` and the sessions and API
 * keys in `auth-stores.ts`; the splits are a size budget, not a boundary.
 */

export class InMemoryReviewerRepository implements ReviewerRepository {
  private readonly rows = new Map<string, Reviewer>()

  async list(): Promise<Reviewer[]> {
    return [...this.rows.values()].sort(oldestFirst((row) => row.createdAt)).map(clone)
  }

  async getById(reviewerId: string): Promise<Reviewer | null> {
    const row = this.rows.get(reviewerId)
    return row === undefined ? null : clone(row)
  }

  async create(reviewer: Reviewer): Promise<Reviewer> {
    return clone(this.write(reviewer))
  }

  async update(reviewerId: string, patch: Partial<Reviewer>): Promise<Reviewer | null> {
    const row = this.rows.get(reviewerId)
    if (row === undefined) return null
    return clone(this.write(patched(row, patch)))
  }

  /**
   * The counter is `adjustOutstanding`'s alone once the row exists, which is
   * what both durable stores do by writing `outstanding_reviews` on INSERT and
   * leaving it out of the conflict branch. A write built from a read taken
   * before an adjustment landed must not walk the count back.
   */
  private write(reviewer: Reviewer): Reviewer {
    const held = this.rows.get(reviewer.id)
    const next = clone(
      held === undefined ? reviewer : { ...reviewer, outstandingReviews: held.outstandingReviews },
    )
    this.rows.set(next.id, next)
    return next
  }

  async adjustOutstanding(reviewerId: string, delta: number): Promise<void> {
    const row = this.rows.get(reviewerId)
    if (row === undefined) return
    this.rows.set(reviewerId, {
      ...row,
      outstandingReviews: Math.max(0, row.outstandingReviews + delta),
    })
  }
}

export class InMemoryReviewRequestRepository implements ReviewRequestRepository {
  private readonly rows = new Map<string, ReviewRequest>()

  async list(filter?: {
    status?: ReviewStatus[]
    limit?: number
    order?: ReviewListOrder
  }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    const by = filter?.order === 'oldest' ? oldestFirst : newestFirst
    const matched = [...this.rows.values()]
      .filter((row) => wanted === undefined || wanted.includes(row.status))
      .sort(by((row) => row.createdAt))
    // Sliced AFTER the sort, which is what the two durable stores do with their
    // `LIMIT` on an ordered read: the cap takes the end of the order the caller
    // asked for, not an arbitrary handful.
    return (filter?.limit === undefined ? matched : matched.slice(0, filter.limit)).map(clone)
  }

  async getById(reviewId: string): Promise<ReviewRequest | null> {
    const row = this.rows.get(reviewId)
    return row === undefined ? null : clone(row)
  }

  async getByPullRequest(ref: {
    owner: string
    repo: string
    number: number
  }): Promise<ReviewRequest | null> {
    for (const row of this.rows.values()) {
      const pr = row.pullRequest
      if (pr.owner === ref.owner && pr.repo === ref.repo && pr.number === ref.number) {
        return clone(row)
      }
    }
    return null
  }

  async create(review: ReviewRequest): Promise<ReviewRequest> {
    this.rows.set(review.id, clone(review))
    return clone(review)
  }

  async update(reviewId: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest | null> {
    const row = this.rows.get(reviewId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(reviewId, next)
    return clone(next)
  }
}

/**
 * Whether a claim is old enough to be given up on.
 *
 * A null timestamp is a row written before the column existed and answers NO:
 * a store that cannot say how old the claim is must not sweep a send that may
 * still be in progress. `claimed_at < ?` in SQL drops those rows for free, and
 * this is the comparator that has to agree with it.
 */
function stalled(claimedAt: number | null, claimedBefore: EpochMs): boolean {
  return claimedAt !== null && claimedAt < claimedBefore
}

export class InMemoryReminderRepository implements ReminderRepository {
  private readonly rows = new Map<string, Reminder>()

  async listByReview(reviewId: string): Promise<Reminder[]> {
    return [...this.rows.values()]
      .filter((row) => row.reviewId === reviewId)
      .sort(oldestFirst((row) => row.dueAt))
      .map(clone)
  }

  async listDue(now: EpochMs, limit: number): Promise<Reminder[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'scheduled' && row.dueAt <= now)
      .sort(oldestFirst((row) => row.dueAt))
      .slice(0, limit)
      .map(clone)
  }

  /**
   * Check and set, which is what the durable stores do with one conditional
   * statement. A store a restart empties has one process reading it, so this
   * cannot actually race; it answers the same way so a suite written against
   * the port proves the same behaviour everywhere.
   */
  async claim(reminder: Reminder, claimedAt: EpochMs): Promise<boolean> {
    const row = this.rows.get(reminder.id)
    if (row === undefined || row.status !== 'scheduled') return false
    this.rows.set(reminder.id, { ...clone(reminder), status: 'sending', claimedAt })
    return true
  }

  /**
   * A claim nobody finished. A null `claimedAt` is a row written before this
   * column existed, and it is NOT stalled: a store with no timestamp cannot say
   * how old the claim is, and guessing would sweep a send that is in progress.
   * Both durable stores compare the column, where SQL drops a null the same way.
   */
  async listStalledClaims(claimedBefore: EpochMs, limit: number): Promise<Reminder[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'sending' && stalled(row.claimedAt, claimedBefore))
      .sort(oldestFirst((row) => row.claimedAt ?? 0))
      .slice(0, limit)
      .map(clone)
  }

  /**
   * Check and set, as `claim` is, and for the same reason: only one recovery of
   * a stranded row may go on to re-plan its review's ladder.
   */
  async abandonClaim(reminder: Reminder, failureReason: string): Promise<boolean> {
    const row = this.rows.get(reminder.id)
    if (row === undefined || row.status !== 'sending') return false
    this.rows.set(reminder.id, { ...row, status: 'failed', failureReason })
    return true
  }

  async create(reminder: Reminder): Promise<Reminder> {
    this.rows.set(reminder.id, clone(reminder))
    return clone(reminder)
  }

  async updateStatus(
    reminderId: string,
    status: ReminderStatus,
    fields?: { sentAt?: EpochMs; failureReason?: string },
  ): Promise<void> {
    const row = this.rows.get(reminderId)
    if (row === undefined) return
    this.rows.set(reminderId, {
      ...row,
      status,
      sentAt: fields?.sentAt ?? row.sentAt,
      failureReason: fields?.failureReason ?? row.failureReason,
    })
  }

  async cancelScheduledForReview(reviewId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.reviewId === reviewId && row.status === 'scheduled') {
        this.rows.set(id, { ...row, status: 'cancelled' })
      }
    }
  }
}

/** `AI_REVIEW_IN_FLIGHT_STATUSES` as a lookup, built once rather than per read. */
const IN_FLIGHT = new Set<AiReviewRun['status']>(AI_REVIEW_IN_FLIGHT_STATUSES)

export class InMemoryAiReviewRunRepository implements AiReviewRunRepository {
  private readonly rows = new Map<string, AiReviewRun>()

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    return [...this.rows.values()]
      .filter((row) => row.reviewId === reviewId)
      .sort(newestFirst((row) => row.requestedAt))
      .map(clone)
  }

  async listInFlight(limit: number): Promise<AiReviewRun[]> {
    return [...this.rows.values()]
      .filter((row) => IN_FLIGHT.has(row.status))
      .sort(
        leastRecentlyPolledFirst(
          (row) => row.lastPolledAt,
          (row) => row.requestedAt,
        ),
      )
      .slice(0, limit)
      .map(clone)
  }

  async getById(runId: string): Promise<AiReviewRun | null> {
    const row = this.rows.get(runId)
    return row === undefined ? null : clone(row)
  }

  async create(run: AiReviewRun): Promise<AiReviewRun> {
    this.rows.set(run.id, clone(run))
    return clone(run)
  }

  async update(runId: string, patch: Partial<AiReviewRun>): Promise<AiReviewRun | null> {
    const row = this.rows.get(runId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(runId, next)
    return clone(next)
  }
}

/**
 * Sealed integration credentials. The rows hold an envelope and never a
 * plaintext, so this store is no more sensitive than the durable one that
 * replaces it; what it does lose on a restart is the token an operator entered,
 * which is the same trade the rest of this adapter makes.
 */
export class InMemoryIntegrationTokenRepository implements IntegrationTokenRepository {
  private readonly rows = new Map<string, StoredIntegrationToken>()

  async list(): Promise<StoredIntegrationToken[]> {
    return [...this.rows.values()]
      .sort((a, b) => byText(a.integrationId, b.integrationId))
      .map(clone)
  }

  async get(integrationId: string): Promise<StoredIntegrationToken | null> {
    const row = this.rows.get(integrationId)
    return row === undefined ? null : clone(row)
  }

  async put(token: StoredIntegrationToken): Promise<StoredIntegrationToken> {
    this.rows.set(token.integrationId, clone(token))
    return clone(token)
  }

  async delete(integrationId: string): Promise<void> {
    this.rows.delete(integrationId)
  }
}

/** One call for the stores a runtime has to supply. */
export function createInMemoryRepositories(): Repositories {
  return {
    reviewers: new InMemoryReviewerRepository(),
    reviews: new InMemoryReviewRequestRepository(),
    reminders: new InMemoryReminderRepository(),
    aiReviewRuns: new InMemoryAiReviewRunRepository(),
    integrationTokens: new InMemoryIntegrationTokenRepository(),
    projects: new InMemoryProjectRepository(),
    identities: new InMemoryIdentityRepository(),
    attention: new InMemoryAttentionRepository(),
    commitments: new InMemoryReviewCommitmentRepository(),
    sessions: new InMemorySessionRepository(),
    apiKeys: new InMemoryApiKeyRepository(),
  }
}

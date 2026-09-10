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
  ReviewRequestRepository,
  StoredIntegrationToken,
} from '@sainte-beuve/kernel'
import { clone, patched } from './clone.js'
import {
  InMemoryAttentionRepository,
  InMemoryIdentityRepository,
  InMemoryProjectRepository,
  InMemoryReviewCommitmentRepository,
} from './workspace-stores.js'

/**
 * In-memory implementations of the repository ports.
 *
 * This is the store every runtime boots with today, and it is deliberately the
 * FIRST adapter rather than a test double retrofitted later: writing the ports
 * against a store that cannot cheat (no SQL escape hatch, no lazy loading) is what
 * keeps them coarse enough for D1 and Postgres to implement without an N+1. The
 * durable adapters land in slice 5; see docs/implementation-plan.md.
 *
 * Every read returns a COPY (see `clone.ts` for why). The workspace stores live
 * in `workspace-stores.ts`; the split is a size budget, not a boundary.
 */

export class InMemoryReviewerRepository implements ReviewerRepository {
  private readonly rows = new Map<string, Reviewer>()

  async list(): Promise<Reviewer[]> {
    return [...this.rows.values()].map(clone)
  }

  async getById(reviewerId: string): Promise<Reviewer | null> {
    const row = this.rows.get(reviewerId)
    return row === undefined ? null : clone(row)
  }

  async create(reviewer: Reviewer): Promise<Reviewer> {
    this.rows.set(reviewer.id, clone(reviewer))
    return clone(reviewer)
  }

  async update(reviewerId: string, patch: Partial<Reviewer>): Promise<Reviewer | null> {
    const row = this.rows.get(reviewerId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(reviewerId, next)
    return clone(next)
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

  async list(filter?: { status?: ReviewStatus[] }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    return [...this.rows.values()]
      .filter((row) => wanted === undefined || wanted.includes(row.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone)
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

export class InMemoryReminderRepository implements ReminderRepository {
  private readonly rows = new Map<string, Reminder>()

  async listByReview(reviewId: string): Promise<Reminder[]> {
    return [...this.rows.values()].filter((row) => row.reviewId === reviewId).map(clone)
  }

  async listDue(now: EpochMs, limit: number): Promise<Reminder[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'scheduled' && row.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, limit)
      .map(clone)
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

export class InMemoryAiReviewRunRepository implements AiReviewRunRepository {
  private readonly rows = new Map<string, AiReviewRun>()

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    return [...this.rows.values()]
      .filter((row) => row.reviewId === reviewId)
      .sort((a, b) => b.requestedAt - a.requestedAt)
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
    return [...this.rows.values()].map(clone)
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
  }
}
